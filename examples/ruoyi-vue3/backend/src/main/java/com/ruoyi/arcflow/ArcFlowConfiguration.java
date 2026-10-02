package com.ruoyi.arcflow;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ruoyi.common.core.domain.entity.SysUser;
import com.ruoyi.common.utils.SecurityUtils;
import com.ruoyi.framework.web.service.PermissionService;
import com.ruoyi.system.service.ISysUserService;
import java.io.IOException;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;

/** Adapter only: RuoYi owns identity, JWT, Redis sessions, roles and permissions. */
@Configuration
public class ArcFlowConfiguration {
    @Bean ActorDirectory arcFlowActors(ISysUserService users, PermissionService permissions) {
        return new ActorDirectory() {
            public Optional<ApprovalService.Person> findActive(String id) {
                if (id == null || !id.matches("[1-9][0-9]{0,18}")) return Optional.empty();
                try { return person(users.selectUserById(Long.valueOf(id))); }
                catch (NumberFormatException ex) { return Optional.empty(); }
            }
            public List<ApprovalService.Person> listActive() {
                SysUser filter = new SysUser(); filter.setStatus("0");
                return users.selectUserList(filter).stream().map(this::person).flatMap(Optional::stream).toList();
            }
            private Optional<ApprovalService.Person> person(SysUser user) {
                if (user == null || !"0".equals(user.getStatus()) || !"0".equals(user.getDelFlag())) return Optional.empty();
                return Optional.of(new ApprovalService.Person(String.valueOf(user.getUserId()), user.getNickName()));
            }
            public boolean canPublish(String id) {
                return id.equals(String.valueOf(SecurityUtils.getUserId())) && permissions.hasPermi("arcflow:process:publish");
            }
        };
    }
    @Bean(destroyMethod = "close") ApprovalService arcFlowApprovals(ObjectMapper mapper, ActorDirectory actors,
            @Value("${arcflow.data-file}") String path, @Value("${arcflow.initial-approver-id}") String approver) throws IOException {
        return new ApprovalService(mapper, path, actors, ProcessDefinition.legacy(approver));
    }
}
