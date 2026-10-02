package com.arcflow.demo;

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
    record Decision(@NotBlank @Size(max=64) String stepId,
                    @NotNull @Pattern(regexp="APPROVE|REJECT") String decision, @Size(max=2000) String comment) {}
    record Publication(@Min(1) int expectedVersion, @NotNull ProcessDefinition definition) {}
    private final ApprovalService service;
    ApprovalController(ApprovalService service) { this.service = service; }
    @GetMapping("/me") ApprovalService.Person me(Principal p) {
        return ApprovalService.PEOPLE.stream().filter(person -> person.id().equals(p.getName())).findFirst().orElseThrow();
    }
    @GetMapping("/people") List<ApprovalService.Person> people() { return ApprovalService.PEOPLE; }
    @GetMapping("/process") ProcessDefinition process() { return service.process(); }
    @PostMapping("/process") ProcessDefinition publish(Principal p, @Valid @RequestBody Publication input) throws IOException {
        return service.publish(p.getName(), input.expectedVersion(), input.definition());
    }
    @GetMapping("/requests") List<ApprovalService.Request> requests(Principal p) { return service.list(p.getName()); }
    @PostMapping("/requests") @ResponseStatus(HttpStatus.CREATED) ApprovalService.Request submit(Principal p, @Valid @RequestBody Submission input) throws IOException {
        return service.submit(p.getName(), input.title(), input.reason(), input.days(), input.processVersion());
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
