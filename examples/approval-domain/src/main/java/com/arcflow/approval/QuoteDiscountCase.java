package com.arcflow.approval;

import com.arcflow.approval.BusinessDocument.QuoteDiscount;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Bounded host example: immutable synthetic quote revisions, explicit ACLs and fixed human review. */
public final class QuoteDiscountCase implements AutoCloseable {
    public record QuoteVersion(String businessId, int revision, String customerRef, String ownerId, Set<String> readerIds,
                               String item, int quantity, BigDecimal listUnitPrice, String currency, String validUntil) {
        public QuoteVersion {
            readerIds = Set.copyOf(readerIds);
            new BusinessDocument.Procurement(businessId, "Quote", "Quote", item, quantity, listUnitPrice, currency).validate();
            if (revision < 1 || customerRef == null || customerRef.isBlank() || customerRef.length() > 128 ||
                !ProcessDefinition.validActorId(ownerId) || !readerIds.contains(ownerId) ||
                !readerIds.stream().allMatch(ProcessDefinition::validActorId))
                throw new IllegalArgumentException("Invalid host quote identity or readers");
            if (validUntil == null || !validUntil.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
                throw new IllegalArgumentException("Invalid host quote date");
            LocalDate.parse(validUntil);
            customerRef = customerRef.trim(); item = item.trim(); listUnitPrice = listUnitPrice.stripTrailingZeros();
        }
        public boolean canRead(String actor) { return readerIds.contains(actor); }
    }
    /** The host must retain immutable historical revisions and enforce current, business-specific access. */
    public interface QuoteSource {
        Optional<QuoteVersion> find(String businessId, int revision);
        int currentRevision(String businessId);
        List<QuoteVersion> available();
    }
    public record View(ApprovalService.Request request, String listTotal, String requestedTotal, String reductionTotal,
                       String discountPercent, boolean thresholdReached, boolean expired, boolean quoteUpdated) {}
    private final ApprovalService approvals;
    private final ActorDirectory actors;
    private final QuoteSource source;
    private final Clock clock;

    public QuoteDiscountCase(ApprovalService approvals, ActorDirectory actors, QuoteSource source, Clock clock) {
        this.approvals = Objects.requireNonNull(approvals); this.actors = Objects.requireNonNull(actors);
        this.source = Objects.requireNonNull(source); this.clock = Objects.requireNonNull(clock).withZone(ZoneOffset.UTC);
        requireFixedProcess();
    }
    public static ProcessDefinition definition(String salesManagerId, String financeId) {
        return new ProcessDefinition(2, "quote-discount", 1, "报价折扣审批 / Quote discount approval", List.of(
            new ProcessDefinition.ProcessNode("start", "start", "提交报价 / Submit quote", null),
            new ProcessDefinition.ProcessNode("salesManager", "approval", "销售经理审核 / Sales manager review", salesManagerId),
            new ProcessDefinition.ProcessNode("finance", "approval", "财务复核 / Finance review", financeId),
            new ProcessDefinition.ProcessNode("end", "end", "审批完成 / Review completed", null)));
    }
    public ProcessDefinition process(String actor) { requireActive(actor); return requireFixedProcess(); }
    private ProcessDefinition requireFixedProcess() {
        var process = approvals.process();
        var steps = process.approvals();
        if (!"quote-discount".equals(process.id()) || steps.size() != 2 ||
            !"salesManager".equals(steps.get(0).id()) || !"finance".equals(steps.get(1).id()) ||
            steps.stream().anyMatch(s -> !"approval".equals(s.type())))
            throw new IllegalStateException("The quote example requires fixed sales manager and finance steps");
        return process;
    }
    public List<QuoteVersion> quotes(String actor) {
        requireActive(actor);
        return source.available().stream().filter(q -> q.canRead(actor) && q.revision() == source.currentRevision(q.businessId())).toList();
    }
    /** Quote identity/revision is the durable host binding, independently of browser retry state. */
    public View submit(String actor, QuoteDiscount document, int processVersion) throws IOException {
        requireActive(actor);
        if (document == null) throw error(HttpStatus.BAD_REQUEST, "Quote discount is required");
        try { document.validate(); } catch (IllegalArgumentException ex) { throw error(HttpStatus.BAD_REQUEST, ex.getMessage()); }
        var quote = readable(actor, document.businessId(), document.quoteRevision());
        if (!actor.equals(quote.ownerId())) throw error(HttpStatus.FORBIDDEN, "Only the quote's assigned salesperson may submit");
        requireSourceMatch(quote, document);
        var process = requireFixedProcess();
        // A deterministic applicant-scoped key binds one immutable quote revision to one request.
        // No custom browser key is accepted by this host endpoint. Core keyed APIs remain unchanged.
        String key = revisionKey(document.businessId(), document.quoteRevision());
        boolean replay = approvals.list(actor).stream().anyMatch(r -> r.business() instanceof QuoteDiscount q &&
            q.businessId().equals(document.businessId()) && q.quoteRevision() == document.quoteRevision());
        if (!replay) {
            if (source.currentRevision(quote.businessId()) != quote.revision())
                throw error(HttpStatus.CONFLICT, "Quote has changed; submit the current revision");
            if (document.validUntilDate().isBefore(LocalDate.now(clock)))
                throw error(HttpStatus.BAD_REQUEST, "Quote has expired; update its validity before submitting");
            if (process.approvals().stream().flatMap(s -> s.participants().stream()).anyMatch(p -> !quote.canRead(p)))
                throw error(HttpStatus.FORBIDDEN, "Every assigned reviewer must have access to this quote revision");
        }
        return view(approvals.submitDocument(actor, document, processVersion, key));
    }
    public List<View> list(String actor) {
        requireActive(actor);
        return approvals.list(actor).stream().filter(r -> {
            var q = quoteDocument(r);
            return source.find(q.businessId(), q.quoteRevision()).filter(v -> v.canRead(actor)).isPresent();
        }).map(this::view).toList();
    }
    public View decide(String actor, String id, String stepId, String decision, String comment) throws IOException {
        requireActive(actor);
        var existing = approvals.list(actor).stream().filter(r -> r.id().equals(id)).findFirst()
            .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Request not found"));
        var quote = quoteDocument(existing);
        readable(actor, quote.businessId(), quote.quoteRevision());
        // Expiry and source revision changes are visible hints, never implicit status transitions.
        return view(approvals.decide(actor, id, stepId, decision, comment));
    }
    private View view(ApprovalService.Request request) {
        var q = quoteDocument(request);
        int scale = "JPY".equals(q.currency()) ? 0 : 2;
        return new View(request, q.listTotal().setScale(scale).toPlainString(), q.requestedTotal().setScale(scale).toPlainString(),
            q.reductionTotal().setScale(scale).toPlainString(), q.discountPercent().toPlainString(),
            q.discountAtLeast(BigDecimal.TEN), q.validUntilDate().isBefore(LocalDate.now(clock)),
            source.currentRevision(q.businessId()) != q.quoteRevision());
    }
    private static QuoteDiscount quoteDocument(ApprovalService.Request request) {
        if (!(request.business() instanceof QuoteDiscount quote)) throw new IllegalStateException("Unexpected document in quote process");
        return quote;
    }
    private QuoteVersion readable(String actor, String businessId, int revision) {
        return source.find(businessId, revision).filter(q -> q.canRead(actor))
            .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Quote revision not found"));
    }
    private static void requireSourceMatch(QuoteVersion q, QuoteDiscount d) {
        if (!q.customerRef().equals(d.customerRef().trim()) || !q.item().equals(d.item().trim()) || q.quantity() != d.quantity() ||
            !q.currency().equals(d.currency()) || q.listUnitPrice().compareTo(d.listUnitPrice()) != 0 || !q.validUntil().equals(d.validUntil()))
            throw error(HttpStatus.CONFLICT, "Quote fields changed; reload the saved quote revision");
    }
    private static String revisionKey(String businessId, int revision) {
        try {
            var hash = MessageDigest.getInstance("SHA-256").digest((businessId + "\\n" + revision).getBytes(StandardCharsets.UTF_8));
            return "quote:" + HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private void requireActive(String actor) {
        if (!ProcessDefinition.validActorId(actor) || actors.findActive(actor).filter(p -> actor.equals(p.id())).isEmpty())
            throw error(HttpStatus.FORBIDDEN, "Unknown or inactive user");
    }
    private static ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }
    @Override public void close() throws IOException { approvals.close(); }
}
