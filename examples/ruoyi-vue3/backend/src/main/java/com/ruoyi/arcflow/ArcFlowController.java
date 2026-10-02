package com.ruoyi.arcflow;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ruoyi.common.core.domain.AjaxResult;
import com.ruoyi.common.utils.SecurityUtils;
import java.io.IOException;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/arcflow")
public class ArcFlowController {
    record Submission(String title, String reason, int days, int processVersion) {}
    record Decision(String stepId, String decision, String comment) {}
    record Publication(int expectedVersion, ProcessDefinition definition) {}
    private final ApprovalService service;
    private final ActorDirectory actors;
    private final ObjectMapper json;
    public ArcFlowController(ApprovalService service, ActorDirectory actors, ObjectMapper mapper) {
        this.service = service; this.actors = actors;
        // Strict decoding belongs only to these endpoints, never RuoYi's global ObjectMapper.
        this.json = ApprovalService.strictMapper(mapper.copy());
    }
    private String actor() {
        String id = String.valueOf(SecurityUtils.getUserId());
        if (actors.findActive(id).isEmpty()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is inactive");
        return id;
    }
    private <T> T body(byte[] bytes, Class<T> type) {
        try { T result = json.readValue(bytes, type); if (result != null) return result; }
        catch (IOException | IllegalArgumentException ex) { /* reject malformed or coercible input */ }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid request body");
    }
    @GetMapping("/me") @PreAuthorize("@ss.hasPermi('arcflow:request:read')")
    public AjaxResult me() {
        String id = actor(); var person = actors.findActive(id).orElseThrow();
        return AjaxResult.success(Map.of("id", id, "displayName", person.displayName(), "canPublish", actors.canPublish(id)));
    }
    @GetMapping("/people") @PreAuthorize("@ss.hasPermi('arcflow:request:read')")
    public AjaxResult people() { actor(); return AjaxResult.success(actors.listActive()); }
    @GetMapping("/process") @PreAuthorize("@ss.hasPermi('arcflow:request:read')")
    public AjaxResult process() { actor(); return AjaxResult.success(service.process()); }
    @PostMapping("/process") @PreAuthorize("@ss.hasPermi('arcflow:process:publish')")
    public AjaxResult publish(@RequestBody byte[] bytes) throws IOException {
        String id = actor(); var input = body(bytes, Publication.class);
        return AjaxResult.success(service.publish(id, input.expectedVersion(), input.definition()));
    }
    @GetMapping("/requests") @PreAuthorize("@ss.hasPermi('arcflow:request:read')")
    public AjaxResult requests() { return AjaxResult.success(service.list(actor())); }
    @PostMapping("/requests") @PreAuthorize("@ss.hasPermi('arcflow:request:submit')")
    public AjaxResult submit(@RequestBody byte[] bytes) throws IOException {
        String id = actor(); var input = body(bytes, Submission.class);
        return AjaxResult.success(service.submit(id, input.title(), input.reason(), input.days(), input.processVersion()));
    }
    @PostMapping("/requests/{id}/decisions") @PreAuthorize("@ss.hasPermi('arcflow:request:decide')")
    public AjaxResult decide(@PathVariable String id, @RequestBody byte[] bytes) throws IOException {
        String actor = actor(); var input = body(bytes, Decision.class);
        return AjaxResult.success(service.decide(actor, id, input.stepId(), input.decision(), input.comment()));
    }
}
