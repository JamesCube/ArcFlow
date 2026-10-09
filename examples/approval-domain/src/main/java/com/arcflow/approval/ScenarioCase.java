package com.arcflow.approval;

import java.io.IOException;
import java.util.List;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Isolated synthetic scenario host. No source system, attachment, payment or writeback side effects. */
public final class ScenarioCase implements AutoCloseable {
    public record View(ApprovalService.Request request,String total,
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) BusinessDocument.ReceivingSummary summary,
        @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) BusinessDocument.PaymentSummary paymentSummary) {
        public View(ApprovalService.Request request, String total) { this(request, total, null, null); }
        public View(ApprovalService.Request request, String total, BusinessDocument.ReceivingSummary summary) { this(request, total, summary, null); }
    }
    private final ScenarioCatalog.Entry entry;
    private final ApprovalService approvals;
    private final ActorDirectory actors;
    public ScenarioCase(ScenarioCatalog.Entry entry,ApprovalService approvals,ActorDirectory actors) {
        this.entry=Objects.requireNonNull(entry); this.approvals=Objects.requireNonNull(approvals); this.actors=Objects.requireNonNull(actors);
        if (!entry.initialProcess().id().equals(approvals.process().id())) throw new IllegalArgumentException("Scenario store belongs to another process");
        approvals.requireDocumentType(entry.documentClass());
        ConditionalRouting.validateForDocument(approvals.process(), entry.documentClass());
    }
    public ScenarioCatalog.Template template(String actor) { active(actor); return entry.template(); }
    public ProcessDefinition process(String actor) { active(actor); return approvals.process(); }
    public ProcessDefinition publish(String actor,int version,ProcessDefinition definition) throws IOException {
        active(actor); approvals.requireDocumentType(entry.documentClass()); return approvals.publishForDocument(actor,version,definition,entry.documentClass());
    }
    public View submit(String actor,BusinessDocument document,int version,String key) throws IOException {
        active(actor);
        if (document == null || !entry.documentClass().equals(document.getClass()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Document type does not belong to this scenario");
        if (key == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"This scenario requires an Idempotency-Key");
        approvals.requireDocumentType(entry.documentClass());
        return view(approvals.submitDocument(actor,document,version,key));
    }
    public List<View> list(String actor) { active(actor); return approvals.list(actor).stream().map(this::view).toList(); }
    public View decide(String actor,String id,String stepId,String decision,String comment) throws IOException {
        active(actor); approvals.requireDocumentType(entry.documentClass());
        return view(approvals.decideForDocument(actor,id,stepId,decision,comment,entry.documentClass()));
    }
    private View view(ApprovalService.Request request) {
        if (request.business() == null || !entry.documentClass().equals(request.business().getClass()))
            throw new IllegalStateException("Unexpected business type in isolated scenario process");
        return new View(request,entry.displayTotal().apply(request.business()),
            request.business() instanceof BusinessDocument.Receiving receiving ? receiving.summary() : null,
            request.business() instanceof BusinessDocument.PaymentRequest payment ? payment.paymentSummary() : null);
    }
    private void active(String actor) {
        if (!ProcessDefinition.validActorId(actor) || actors.findActive(actor).filter(person -> actor.equals(person.id())).isEmpty())
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Unknown or inactive user");
    }
    @Override public void close() throws IOException { approvals.close(); }
}
