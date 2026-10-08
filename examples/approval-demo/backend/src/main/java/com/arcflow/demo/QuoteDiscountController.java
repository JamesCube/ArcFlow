package com.arcflow.demo;

import com.arcflow.approval.*;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.security.Principal;
import java.util.List;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/crm")
class QuoteDiscountController {
    record Submission(@JsonProperty(required=true) @NotNull BusinessDocument.QuoteDiscount business,
                      @JsonProperty(required=true) @Min(1) int processVersion) {}
    record Decision(@NotBlank @Size(max=64) String stepId,
                    @NotNull @Pattern(regexp="APPROVE|REJECT") String decision, @Size(max=2000) String comment) {}
    private final QuoteDiscountCase quotes;
    QuoteDiscountController(QuoteDiscountCase quotes) { this.quotes = quotes; }
    @GetMapping("/process") ProcessDefinition process(Principal actor) { return quotes.process(actor.getName()); }
    @GetMapping("/quotes") List<QuoteDiscountCase.QuoteVersion> quotes(Principal actor) { return quotes.quotes(actor.getName()); }
    @GetMapping("/requests") List<QuoteDiscountCase.View> requests(Principal actor) { return quotes.list(actor.getName()); }
    @PostMapping("/documents") @ResponseStatus(HttpStatus.CREATED) QuoteDiscountCase.View submit(Principal actor,
            @Valid @RequestBody Submission body, @RequestHeader HttpHeaders headers) throws IOException {
        if (headers.containsKey("Idempotency-Key"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "This sample binds submissions to the quote revision; omit Idempotency-Key");
        return quotes.submit(actor.getName(), body.business(), body.processVersion());
    }
    @PostMapping("/requests/{id}/decisions") QuoteDiscountCase.View decide(Principal actor, @PathVariable String id,
            @Valid @RequestBody Decision body) throws IOException {
        return quotes.decide(actor.getName(), id, body.stepId(), body.decision(), body.comment());
    }
}
