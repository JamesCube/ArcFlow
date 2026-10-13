package com.arcflow.approval.graph;

import com.arcflow.approval.BusinessDocument.QuoteDiscount;
import com.arcflow.approval.QuoteDiscountCase;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Host quote source authorization. Never participates in deterministic durable graph replay. */
public final class GraphQuotePolicy {
    private final QuoteDiscountCase.QuoteSource source;
    private final Clock clock;
    public GraphQuotePolicy(QuoteDiscountCase.QuoteSource source, Clock clock) {
        this.source = Objects.requireNonNull(source); this.clock = Objects.requireNonNull(clock).withZone(ZoneOffset.UTC);
    }
    public List<QuoteDiscountCase.QuoteVersion> quotes(String actor) {
        return source.available().stream().filter(q -> q.canRead(actor) && q.revision() == source.currentRevision(q.businessId())).toList();
    }
    public boolean canRead(String actor, QuoteDiscount document) {
        return source.find(document.businessId(),document.quoteRevision()).filter(q -> q.canRead(actor)).isPresent();
    }
    public void requireRead(String actor, QuoteDiscount document) { readable(actor, document); }
    public void requireSubmission(String actor, QuoteDiscount document) {
        var quote = readable(actor,document);
        owner(quote,actor); match(quote,document);
    }
    public void requirePreview(String actor, QuoteDiscount document, GraphInstance preview) {
        var quote = readable(actor,document); match(quote,document); fresh(quote,document); reviewers(quote,preview);
    }
    public void requireFresh(String actor, QuoteDiscount document, GraphInstance instance) {
        var quote = readable(actor,document); owner(quote,actor); match(quote,document); fresh(quote,document); reviewers(quote,instance);
    }
    private static void owner(QuoteDiscountCase.QuoteVersion quote,String actor) {
        if (!actor.equals(quote.ownerId())) throw error(HttpStatus.FORBIDDEN,"Only the quote's assigned salesperson may submit");
    }
    private void fresh(QuoteDiscountCase.QuoteVersion quote, QuoteDiscount document) {
        if (source.currentRevision(quote.businessId()) != quote.revision()) throw error(HttpStatus.CONFLICT,"Quote has changed; submit the current revision");
        if (document.validUntilDate().isBefore(LocalDate.now(clock))) throw error(HttpStatus.BAD_REQUEST,"Quote has expired; update its validity before submitting");
    }
    private void reviewers(QuoteDiscountCase.QuoteVersion quote, GraphInstance instance) {
        if (GraphEngine.selectedParticipants(instance).stream().anyMatch(p -> !quote.canRead(p)))
            throw error(HttpStatus.FORBIDDEN,"Every selected reviewer must have access to this quote revision");
    }
    private QuoteDiscountCase.QuoteVersion readable(String actor, QuoteDiscount document) {
        return source.find(document.businessId(),document.quoteRevision()).filter(q -> q.canRead(actor))
            .orElseThrow(() -> error(HttpStatus.NOT_FOUND,"Quote revision not found"));
    }
    private static void match(QuoteDiscountCase.QuoteVersion q, QuoteDiscount d) {
        if (!q.customerRef().equals(d.customerRef().trim()) || !q.item().equals(d.item().trim()) || q.quantity()!=d.quantity() ||
            !q.currency().equals(d.currency()) || q.listUnitPrice().compareTo(d.listUnitPrice())!=0 || !q.validUntil().equals(d.validUntil()))
            throw error(HttpStatus.CONFLICT,"Quote fields changed; reload the saved quote revision");
    }
    /** Same binding as the legacy quote host: the separator is the literal two-character backslash+n. */
    public static String revisionKey(String businessId, int revision) {
        try { return "quote:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((businessId + "\\n" + revision).getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private static ResponseStatusException error(HttpStatus status,String message) { return new ResponseStatusException(status,message); }
}
