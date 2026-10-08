package com.arcflow.demo;

import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.BusinessDocument;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.security.Principal;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
class ApprovalController {
    record Submission(@NotBlank @Size(max=120) String title, @NotBlank @Size(max=2000) String reason,
                      @Min(1) @Max(365) int days, @Min(1) int processVersion) {}
    record DocumentSubmission(@JsonProperty(required=true) @NotNull BusinessDocument business,
                              @JsonProperty(required=true) @Min(1) int processVersion) {}
    record Decision(@NotBlank @Size(max=64) String stepId,
                    @NotNull @Pattern(regexp="APPROVE|REJECT") String decision, @Size(max=2000) String comment) {}
    record Publication(@Min(1) int expectedVersion, @NotNull ProcessDefinition definition) {}
    private final ApprovalService service;
    private final com.arcflow.approval.ActorDirectory actors;
    ApprovalController(ApprovalService service, com.arcflow.approval.ActorDirectory actors) { this.service = service; this.actors = actors; }
    @GetMapping("/me") ApprovalService.Person me(Principal p) {
        return actors.findActive(p.getName()).orElseThrow();
    }
    @GetMapping("/people") List<ApprovalService.Person> people() { return actors.listActive(); }
    @GetMapping("/process") ProcessDefinition process() { return service.process(); }
    @PostMapping("/process") ProcessDefinition publish(Principal p, @Valid @RequestBody Publication input) throws IOException {
        return service.publish(p.getName(), input.expectedVersion(), input.definition());
    }
    @GetMapping("/requests") List<ApprovalService.Request> requests(Principal p) { return service.list(p.getName()); }
    @GetMapping("/requests/inbox") ApprovalService.InboxPage inbox(Principal p,
            @RequestParam org.springframework.util.MultiValueMap<String,String> parameters) throws IOException {
        return service.inbox(p.getName(), parameters);
    }
    @PostMapping("/requests") @ResponseStatus(HttpStatus.CREATED) ApprovalService.Request submit(Principal p, @Valid @RequestBody Submission input,
            @RequestHeader HttpHeaders headers) throws IOException {
        return service.submit(p.getName(), input.title(), input.reason(), input.days(), input.processVersion(), submissionKey(headers));
    }
    @PostMapping("/documents") @ResponseStatus(HttpStatus.CREATED) ApprovalService.Request submitDocument(Principal p,
            @Valid @RequestBody DocumentSubmission input, @RequestHeader HttpHeaders headers) throws IOException {
        if (!(input.business() instanceof BusinessDocument.Leave || input.business() instanceof BusinessDocument.Procurement))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "This document requires its dedicated business host submission endpoint");
        return service.submitDocument(p.getName(), input.business(), input.processVersion(), submissionKey(headers));
    }
    private static String submissionKey(HttpHeaders headers) {
        List<String> keys = headers.get("Idempotency-Key");
        if (keys != null && keys.size() != 1)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Exactly one Idempotency-Key is required when present");
        // A missing header preserves legacy behavior. Empty/combined/malformed values
        // are deliberately passed through to the domain's strict key validation.
        return keys == null ? null : keys.get(0);
    }
    @PostMapping("/requests/{id}/decisions") ApprovalService.Request decide(Principal p, @PathVariable String id, @Valid @RequestBody Decision input) throws IOException {
        return service.decide(p.getName(), id, input.stepId(), input.decision(), input.comment());
    }
}

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<Map<String,String>> status(ResponseStatusException ex) {
        return ResponseEntity.status(ex.getStatusCode()).body(Map.of("message", Objects.requireNonNullElse(ex.getReason(), "Request failed")));
    }
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    ResponseEntity<Map<String,String>> invalid(Exception ex) { return ResponseEntity.badRequest().body(Map.of("message", "Invalid request body or fields")); }
    @ExceptionHandler(IOException.class) ResponseEntity<Map<String,String>> storage(IOException ex) {
        return ResponseEntity.status(503).body(Map.of("message", "Storage unavailable; no change confirmed. Refresh before retrying."));
    }
}
