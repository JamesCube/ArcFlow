package com.arcflow.demo;

import com.arcflow.approval.*;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.security.Principal;
import java.util.*;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/scenarios")
class ScenarioController {
    record Submission(@JsonProperty(required=true) @NotNull BusinessDocument business,
                      @JsonProperty(required=true) @Min(1) int processVersion) {}
    record Publication(@JsonProperty(required=true) @Min(1) int expectedVersion,@NotNull ProcessDefinition definition) {}
    record Decision(@NotBlank @Size(max=64) String stepId,@NotNull @Pattern(regexp="APPROVE|REJECT") String decision,@Size(max=2000) String comment) {}
    private final Map<String,ScenarioCase> scenarios;
    ScenarioController(@Qualifier("scenarioRegistry") Map<String,ScenarioCase> scenarios) { this.scenarios=Map.copyOf(scenarios); }
    private ScenarioCase scenario(String id) {
        var scenario=scenarios.get(id);
        if(scenario==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Scenario not found");
        return scenario;
    }
    @GetMapping List<ScenarioCatalog.Template> catalog(Principal actor) { return scenarios.values().stream().map(item -> item.template(actor.getName())).sorted(Comparator.comparing(ScenarioCatalog.Template::id).reversed()).toList(); }
    @GetMapping("/{scenarioId}/process") ProcessDefinition process(Principal actor,@PathVariable String scenarioId) { return scenario(scenarioId).process(actor.getName()); }
    @PostMapping("/{scenarioId}/process") ProcessDefinition publish(Principal actor,@PathVariable String scenarioId,@Valid @RequestBody Publication input) throws IOException {
        return scenario(scenarioId).publish(actor.getName(),input.expectedVersion(),input.definition());
    }
    @GetMapping("/{scenarioId}/requests") List<ScenarioCase.View> requests(Principal actor,@PathVariable String scenarioId) { return scenario(scenarioId).list(actor.getName()); }
    @PostMapping("/{scenarioId}/documents") @ResponseStatus(HttpStatus.CREATED) ScenarioCase.View submit(Principal actor,@PathVariable String scenarioId,
            @Valid @RequestBody Submission input,@RequestHeader HttpHeaders headers) throws IOException {
        var keys=headers.get("Idempotency-Key");
        if(keys==null || keys.size()!=1) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Exactly one Idempotency-Key is required");
        return scenario(scenarioId).submit(actor.getName(),input.business(),input.processVersion(),keys.get(0));
    }
    @PostMapping("/{scenarioId}/requests/{id}/decisions") ScenarioCase.View decide(Principal actor,@PathVariable String scenarioId,@PathVariable String id,
            @Valid @RequestBody Decision input) throws IOException {
        return scenario(scenarioId).decide(actor.getName(),id,input.stepId(),input.decision(),input.comment());
    }
}
