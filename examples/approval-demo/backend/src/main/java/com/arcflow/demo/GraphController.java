package com.arcflow.demo;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.BusinessDocument;
import com.arcflow.approval.graph.GraphApprovalService;
import com.arcflow.approval.graph.GraphApprovalStore;
import com.arcflow.approval.graph.GraphDefinition;
import com.arcflow.approval.graph.GraphInstance;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Explicit graph workspace. Legacy linear APIs never decode or execute graph definitions. */
@RestController
@RequestMapping("/api/graphs/{scenario}")
class GraphController {
    record DraftInput(@JsonProperty(required=true) @Min(0) long expectedRevision,
                      @JsonProperty(required=true) @NotNull GraphDefinition definition) {}
    record Publication(@JsonProperty(required=true) @Min(1) int expectedVersion,
                       @JsonProperty(required=true) @Min(0) long expectedDraftRevision) {}
    record Preview(@JsonProperty(required=true) @NotNull GraphDefinition definition,
                   @JsonProperty(required=true) @NotNull BusinessDocument business) {}
    record Submission(@JsonProperty(required=true) @Min(1) int expectedVersion,
                      @JsonProperty(required=true) @NotNull BusinessDocument business) {}
    record Decision(@JsonProperty(required=true) @NotNull @Pattern(regexp="APPROVE|REJECT") String decision,
                    @JsonProperty(required=true) @NotNull @Size(max=2000) String comment) {}
    record Validation(List<GraphDefinition.Diagnostic> diagnostics) {}
    record Limits(int maxNodes,int maxEdges,int maxHumanNodes,int maxRegionDepth,
                  int minBranches,int maxBranches,int maxParticipants,int maxPredicateAtoms,int maxRuleAtoms) {}
    record Fact(String field,String type,List<String> currencies,List<String> operators) {}
    record Permissions(boolean canPublish,boolean canSubmit) {}
    record Capabilities(int schemaVersion,String businessType,List<String> nodeTypes,Limits limits,
                        List<Fact> facts,Permissions permissions,List<String> hosts,List<String> persistence) {}

    private final GraphConfiguration.Services services;
    private final ActorDirectory actors;
    GraphController(GraphConfiguration.Services services,ActorDirectory actors) { this.services=services;this.actors=actors; }

    @GetMapping("/capabilities") Capabilities capabilities(@PathVariable String scenario,Principal actor) throws IOException {
        services.get(scenario).process(actor.getName()); // Recheck the active directory, not just the HTTP account.
        return new Capabilities(services.get(scenario).schemaVersion(),services.get(scenario).scenario().businessType(),
            List.of("start","end","approval","parallelApproval","exclusiveGateway","exclusiveMerge","parallelFork","parallelJoin"),
            new Limits(32,48,16,2,2,4,16,32,8),
            services.get(scenario).scenario().facts().stream().sorted().map(field -> new Fact(field,field.endsWith("hasRejectedLines")?"boolean":field.endsWith("discountPercent")?"percent":"money",
                field.endsWith("hasRejectedLines")||field.endsWith("discountPercent")?List.of():List.of("CNY","USD","EUR","GBP","JPY"),
                field.endsWith("hasRejectedLines")?List.of("EQ"):List.of("EQ","GT","GTE","LT","LTE"))).toList(),
            new Permissions(actors.canPublish(actor.getName()),services.get(scenario).canSubmit(actor.getName())),List.of("standalone"),List.of("json","jdbc-library"));
    }
    @GetMapping("/process") GraphDefinition process(@PathVariable String scenario,Principal actor) throws IOException { return services.get(scenario).process(actor.getName()); }
    @GetMapping("/workspace") GraphApprovalStore.Snapshot workspace(@PathVariable String scenario,Principal actor) throws IOException { return services.get(scenario).workspace(actor.getName()); }
    @GetMapping("/users") List<ApprovalService.Person> users(@PathVariable String scenario,Principal actor) throws IOException { return services.get(scenario).users(actor.getName()); }
    @PutMapping("/draft") GraphApprovalStore.Draft saveDraft(@PathVariable String scenario,Principal actor,@Valid @RequestBody DraftInput input) throws IOException {
        return services.get(scenario).saveDraft(actor.getName(),input.expectedRevision(),input.definition());
    }
    @PostMapping("/validate") Validation validate(@PathVariable String scenario,Principal actor,@NotNull @RequestBody GraphDefinition definition) throws IOException {
        if(definition==null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"A graph definition is required");
        return new Validation(services.get(scenario).validate(actor.getName(),definition));
    }
    @PostMapping("/preview") GraphInstance preview(@PathVariable String scenario,Principal actor,@Valid @RequestBody Preview input) throws IOException {
        return services.get(scenario).preview(actor.getName(),input.definition(),input.business());
    }
    @PostMapping("/publish") GraphDefinition publish(@PathVariable String scenario,Principal actor,@Valid @RequestBody Publication input) throws IOException {
        return services.get(scenario).publish(actor.getName(),input.expectedVersion(),input.expectedDraftRevision());
    }
    @GetMapping("/requests") List<GraphInstance> requests(@PathVariable String scenario,Principal actor) throws IOException { return services.get(scenario).list(actor.getName()); }
    @GetMapping("/requests/{id}") GraphInstance request(@PathVariable String scenario,Principal actor,@PathVariable String id) throws IOException { return services.get(scenario).get(actor.getName(),id); }
    @PostMapping("/requests") @ResponseStatus(HttpStatus.CREATED) GraphInstance submit(@PathVariable String scenario,Principal actor,
            @Valid @RequestBody Submission input,@RequestHeader HttpHeaders headers) throws IOException {
        return services.get(scenario).submit(actor.getName(),input.expectedVersion(),input.business(),key(headers));
    }
    @PostMapping("/requests/{id}/tasks/{taskId}/decision") GraphInstance decide(@PathVariable String scenario,Principal actor,@PathVariable String id,
            @PathVariable String taskId,@Valid @RequestBody Decision input,@RequestHeader HttpHeaders headers) throws IOException {
        return services.get(scenario).decide(actor.getName(),id,taskId,input.decision(),input.comment(),key(headers));
    }
    @GetMapping("/quotes") List<com.arcflow.approval.QuoteDiscountCase.QuoteVersion> quotes(@PathVariable String scenario,Principal actor) {
        return services.get(scenario).quotes(actor.getName());
    }
    private static String key(HttpHeaders headers) {
        var keys=headers.get("Idempotency-Key");
        if(keys==null || keys.size()!=1) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Exactly one Idempotency-Key is required");
        return keys.get(0);
    }
    @ExceptionHandler(IllegalArgumentException.class) ResponseEntity<Map<String,String>> invalid(IllegalArgumentException failure) {
        return ResponseEntity.badRequest().body(Map.of("message",failure.getMessage()==null?"Invalid graph request":failure.getMessage()));
    }
    @ExceptionHandler(UncheckedIOException.class) ResponseEntity<Map<String,String>> storage(UncheckedIOException failure) {
        return ResponseEntity.status(503).body(Map.of("message","Storage unavailable; no change confirmed. Refresh before retrying."));
    }
}
