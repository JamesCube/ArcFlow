package com.ruoyi.arcflow;

import com.arcflow.approval.BusinessDocument;
import com.arcflow.approval.graph.*;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ruoyi.common.core.domain.AjaxResult;
import com.ruoyi.common.utils.SecurityUtils;
import java.io.IOException;
import java.util.List;
import org.springframework.http.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** One native workspace. Neither a scenario selector nor a filesystem path is accepted from clients. */
@RestController
@RequestMapping("/arcflow/graphs/travel")
public class ArcFlowGraphController {
    record DraftInput(@JsonProperty(required=true) long expectedRevision,@JsonProperty(required=true) GraphDefinition definition) {}
    record Publication(@JsonProperty(required=true) int expectedVersion,@JsonProperty(required=true) long expectedDraftRevision) {}
    record Preview(@JsonProperty(required=true) GraphDefinition definition,@JsonProperty(required=true) BusinessDocument business) {}
    record Submission(@JsonProperty(required=true) int expectedVersion,@JsonProperty(required=true) BusinessDocument business) {}
    record Decision(@JsonProperty(required=true) String decision,@JsonProperty(required=true) String comment) {}
    record Validation(List<GraphDefinition.Diagnostic> diagnostics) {}
    record Limits(int maxNodes,int maxEdges,int maxHumanNodes,int maxRegionDepth,int minBranches,int maxBranches,int maxParticipants,int maxPredicateAtoms,int maxRuleAtoms) {}
    record Fact(String field,String type,List<String> currencies,List<String> operators) {}
    record Permissions(boolean canPublish,boolean canSubmit,boolean canDecide) {}
    record Capabilities(int schemaVersion,String businessType,List<String> nodeTypes,Limits limits,List<Fact> facts,Permissions permissions,List<String> hosts,List<String> persistence) {}
    private final GraphApprovalService service;
    private final ArcFlowGraphConfiguration.Access access;
    private final ObjectMapper json;
    public ArcFlowGraphController(GraphApprovalService service,ArcFlowGraphConfiguration.Access access,ObjectMapper mapper) {
        this.service=service;this.access=access;this.json=GraphApprovalService.strictMapper(mapper.copy());
    }
    private String actor(String permission) {
        String id=String.valueOf(SecurityUtils.getUserId());
        if(!access.allowed(id,permission))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Active account and native permission required");
        return id;
    }
    private <T> T body(byte[] bytes,Class<T> type) {
        try { T result=json.readValue(bytes,type);if(result!=null)return result; }
        catch(IOException | IllegalArgumentException invalid) { /* strict, endpoint-local decoding */ }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid graph request body");
    }
    private AjaxResult success(Object data) {
        // A tree preserves explicit null record fields despite RuoYi's global NON_NULL mapper.
        return AjaxResult.success((Object)json.valueToTree(data));
    }
    private static void require(boolean valid) { if(!valid)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid graph request body"); }
    private static String key(HttpHeaders headers) {
        var keys=headers.get("Idempotency-Key");
        if(keys==null || keys.size()!=1 || !GraphEngine.validKey(keys.get(0)))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Exactly one valid Idempotency-Key is required");
        return keys.get(0);
    }
    @GetMapping("/capabilities") @PreAuthorize("@ss.hasPermi('arcflow:request:read')")
    public AjaxResult capabilities() {
        String id=actor("arcflow:request:read");service.process(id);
        return success(new Capabilities(service.schemaVersion(),service.scenario().businessType(),
            List.of("start","end","approval","parallelApproval","exclusiveGateway","exclusiveMerge","parallelFork","parallelJoin"),
            new Limits(32,48,16,2,2,4,16,32,8),
            service.scenario().facts().stream().sorted().map(field -> new Fact(field,"money",List.of("CNY","USD","EUR","GBP","JPY"),List.of("EQ","GT","GTE","LT","LTE"))).toList(),
            new Permissions(access.actors.canPublish(id),access.allowed(id,"arcflow:request:submit")&&service.canSubmit(id),access.allowed(id,"arcflow:request:decide")),List.of("ruoyi"),List.of("json")));
    }
    @GetMapping("/process") @PreAuthorize("@ss.hasPermi('arcflow:request:read')")
    public AjaxResult process() { return success(service.process(actor("arcflow:request:read"))); }
    @GetMapping("/users") @PreAuthorize("@ss.hasPermi('arcflow:request:read')")
    public AjaxResult users() { return success(service.users(actor("arcflow:request:read"))); }
    @GetMapping("/workspace") @PreAuthorize("@ss.hasPermi('arcflow:process:publish')")
    public AjaxResult workspace() { return success(service.workspace(actor("arcflow:process:publish"))); }
    @PutMapping("/draft") @PreAuthorize("@ss.hasPermi('arcflow:process:publish')")
    public AjaxResult saveDraft(@RequestBody byte[] bytes) throws IOException {
        String id=actor("arcflow:process:publish");var input=body(bytes,DraftInput.class);
        require(input.expectedRevision()>=0 && input.definition()!=null);
        return success(service.saveDraft(id,input.expectedRevision(),input.definition()));
    }
    @PostMapping("/validate") @PreAuthorize("@ss.hasPermi('arcflow:process:publish')")
    public AjaxResult validate(@RequestBody byte[] bytes) {
        String id=actor("arcflow:process:publish");return success(new Validation(service.validate(id,body(bytes,GraphDefinition.class))));
    }
    @PostMapping("/preview") @PreAuthorize("@ss.hasPermi('arcflow:process:publish')")
    public AjaxResult preview(@RequestBody byte[] bytes) {
        String id=actor("arcflow:process:publish");var input=body(bytes,Preview.class);
        require(input.definition()!=null && input.business()!=null);
        return success(service.preview(id,input.definition(),input.business()));
    }
    @PostMapping("/publish") @PreAuthorize("@ss.hasPermi('arcflow:process:publish')")
    public AjaxResult publish(@RequestBody byte[] bytes) throws IOException {
        String id=actor("arcflow:process:publish");var input=body(bytes,Publication.class);
        require(input.expectedVersion()>=1 && input.expectedDraftRevision()>=0);
        return success(service.publish(id,input.expectedVersion(),input.expectedDraftRevision()));
    }
    @GetMapping("/requests") @PreAuthorize("@ss.hasPermi('arcflow:request:read')")
    public AjaxResult requests() { return success(service.list(actor("arcflow:request:read"))); }
    @GetMapping("/requests/{id}") @PreAuthorize("@ss.hasPermi('arcflow:request:read')")
    public AjaxResult request(@PathVariable String id) { return success(service.get(actor("arcflow:request:read"),id)); }
    @PostMapping("/requests") @PreAuthorize("@ss.hasPermi('arcflow:request:submit')")
    public AjaxResult submit(@RequestBody byte[] bytes,@RequestHeader HttpHeaders headers) throws IOException {
        String id=actor("arcflow:request:submit");var input=body(bytes,Submission.class);
        require(input.expectedVersion()>=1 && input.business()!=null);
        return success(service.submit(id,input.expectedVersion(),input.business(),key(headers)));
    }
    @PostMapping("/requests/{id}/tasks/{taskId}/decision") @PreAuthorize("@ss.hasPermi('arcflow:request:decide')")
    public AjaxResult decide(@PathVariable String id,@PathVariable String taskId,@RequestBody byte[] bytes,@RequestHeader HttpHeaders headers) throws IOException {
        String actor=actor("arcflow:request:decide");var input=body(bytes,Decision.class);
        require(("APPROVE".equals(input.decision())||"REJECT".equals(input.decision())) && input.comment()!=null && input.comment().length()<=2000);
        return success(service.decide(actor,id,taskId,input.decision(),input.comment(),key(headers)));
    }
}
