package com.ruoyi.arcflow;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.graph.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ruoyi.common.core.domain.entity.SysUser;
import com.ruoyi.common.utils.SecurityUtils;
import com.ruoyi.framework.web.service.SysPermissionService;
import com.ruoyi.system.service.ISysUserService;
import java.io.IOException;
import java.nio.file.Path;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;

/** Native travel only. Identity remains RuoYi-owned; graph state is isolated from sequential state. */
@Configuration
public class ArcFlowGraphConfiguration {
    static final class Access {
        private final ISysUserService users;
        private final SysPermissionService permissions;
        final ActorDirectory actors;
        Access(ActorDirectory directory, ISysUserService users, SysPermissionService permissions) {
            this.users=users; this.permissions=permissions;
            actors=new ActorDirectory() {
                public Optional<ApprovalService.Person> findActive(String id) { return directory.findActive(id); }
                public List<ApprovalService.Person> listActive() { return directory.listActive(); }
                public boolean canPublish(String id) {
                    return id.equals(String.valueOf(SecurityUtils.getUserId())) && allowed(id,"arcflow:process:publish");
                }
                public boolean canAssignApproval(String id) {
                    return allowed(id,"arcflow:request:read") && allowed(id,"arcflow:request:decide");
                }
            };
        }
        boolean allowed(String id,String permission) {
            if(id==null || !id.matches("[1-9][0-9]{0,18}"))return false;
            final SysUser user;
            try { user=users.selectUserById(Long.valueOf(id)); }
            catch(NumberFormatException invalid) { return false; }
            if(user==null || !"0".equals(user.getStatus()) || !"0".equals(user.getDelFlag()))return false;
            // Fresh role/menu lookup, not the JWT's cached permissions. A wildcard grants host RBAC,
            // never graph visibility, task membership, or a vote on another person's task.
            Set<String> grants=permissions.getMenuPermission(user);
            return grants.contains("*:*:*") || grants.contains(permission);
        }
    }
    @Bean Access arcFlowGraphAccess(ActorDirectory actors,ISysUserService users,SysPermissionService permissions) {
        return new Access(actors,users,permissions);
    }
    @Bean(destroyMethod="close") GraphApprovalService arcFlowTravelGraph(ObjectMapper mapper,Access access,
            @Value("${arcflow.data-file}") String sequential,
            @Value("${arcflow.travel-graph.data-file}") String file,
            @Value("${arcflow.travel-graph.manager-id}") String manager,
            @Value("${arcflow.travel-graph.operations-id}") String operations,
            @Value("${arcflow.travel-graph.finance-id}") String finance) throws IOException {
        if(Path.of(file).toAbsolutePath().normalize().equals(Path.of(sequential).toAbsolutePath().normalize()))
            throw new IllegalArgumentException("Travel graph and sequential data files must be distinct");
        for(String id:List.of(manager,operations,finance)) {
            try { if(!id.matches("[1-9][0-9]{0,18}") || Long.parseLong(id)<=0)throw new NumberFormatException(); }
            catch(NumberFormatException invalid) { throw new IllegalArgumentException("Travel graph initial assignees must be numeric RuoYi user IDs"); }
        }
        var store=new JsonGraphApprovalStore(mapper,file,GraphSamples.travel(manager,operations,finance));
        try { return new GraphApprovalService(store,access.actors); }
        catch(RuntimeException failure) { try{store.close();}catch(IOException cleanup){failure.addSuppressed(cleanup);}throw failure; }
    }
}
