package com.arcflow.demo;

import com.arcflow.approval.*;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
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
    private final ObjectMapper submissionMapper;
    static final int MAX_SEAL_SUBMISSION_UTF16_UNITS = 8_000_000;
    ScenarioController(@Qualifier("scenarioRegistry") Map<String,ScenarioCase> scenarios, ObjectMapper mapper) {
        this.scenarios=Map.copyOf(scenarios);
        this.submissionMapper=ApprovalService.strictMapper(mapper.copy());
    }
    private ScenarioCase scenario(String id) {
        var scenario=scenarios.get(id);
        if(scenario==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Scenario not found");
        return scenario;
    }
    @GetMapping List<ScenarioCatalog.Template> catalog(Principal actor) {
        return scenarios.values().stream().map(item -> item.template(actor.getName()))
            .sorted(Comparator.comparing(ScenarioCatalog.Template::id)).toList();
    }
    @GetMapping("/{scenarioId}/process") ProcessDefinition process(Principal actor,@PathVariable String scenarioId) { return scenario(scenarioId).process(actor.getName()); }
    @PostMapping("/{scenarioId}/process") ProcessDefinition publish(Principal actor,@PathVariable String scenarioId,@Valid @RequestBody Publication input) throws IOException {
        return scenario(scenarioId).publish(actor.getName(),input.expectedVersion(),input.definition());
    }
    @GetMapping("/{scenarioId}/requests") List<ScenarioCase.View> requests(Principal actor,@PathVariable String scenarioId) { return scenario(scenarioId).list(actor.getName()); }
    @PostMapping("/{scenarioId}/documents") @ResponseStatus(HttpStatus.CREATED) ScenarioCase.View submit(Principal actor,@PathVariable String scenarioId,
            @Valid @RequestBody Submission input,@RequestHeader HttpHeaders headers) throws IOException {
        // Do not let another JSON media type fall through to the unbounded generic DTO route.
        if("oa-seal-use".equals(scenarioId))
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,"Seal submissions require application/json");
        return scenario(scenarioId).submit(actor.getName(),input.business(),input.processVersion(),submissionKey(headers));
    }
    /** The Seal raw-input bound belongs to this HTTP submission, never to an entire saved snapshot. */
    @PostMapping(value="/oa-seal-use/documents",consumes=MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED) ScenarioCase.View submitSeal(Principal actor,@RequestBody byte[] bytes,@RequestHeader HttpHeaders headers) throws IOException {
        String key=submissionKey(headers);
        // UTF-8 needs at most three bytes per UTF-16 code unit. Reject impossible lengths before decoding.
        if(bytes.length>3L*MAX_SEAL_SUBMISSION_UTF16_UNITS)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Seal submission exceeds 8000000 UTF-16 code units");
        String raw;
        try { raw=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString(); }
        catch(CharacterCodingException invalid) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Seal submission requires valid UTF-8 JSON"); }
        if(raw.length()>MAX_SEAL_SUBMISSION_UTF16_UNITS)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Seal submission exceeds 8000000 UTF-16 code units");
        Submission input;
        try { input=submissionMapper.readValue(raw,Submission.class); }
        catch(JsonProcessingException invalid) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid request body or fields"); }
        if(input==null || input.business()==null || input.processVersion()<1)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid request body or fields");
        return scenario("oa-seal-use").submit(actor.getName(),input.business(),input.processVersion(),key);
    }
    private static String submissionKey(HttpHeaders headers) {
        var keys=headers.get("Idempotency-Key");
        if(keys==null || keys.size()!=1) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Exactly one Idempotency-Key is required");
        return keys.get(0);
    }
    @PostMapping("/{scenarioId}/requests/{id}/decisions") ScenarioCase.View decide(Principal actor,@PathVariable String scenarioId,@PathVariable String id,
            @Valid @RequestBody Decision input) throws IOException {
        return scenario(scenarioId).decide(actor.getName(),id,input.stepId(),input.decision(),input.comment());
    }
}
