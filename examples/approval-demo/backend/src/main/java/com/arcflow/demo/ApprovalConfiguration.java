package com.arcflow.demo;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.ApprovalService;
import com.arcflow.approval.ProcessDefinition;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class ApprovalConfiguration {
    static ActorDirectory demoDirectory() {
        return new ActorDirectory() {
            private final List<ApprovalService.Person> people = List.of(
                new ApprovalService.Person("alice", "Alice"), new ApprovalService.Person("bob", "Bob"), new ApprovalService.Person("carol", "Carol"));
            public Optional<ApprovalService.Person> findActive(String id) { return people.stream().filter(p -> p.id().equals(id)).findFirst(); }
            public List<ApprovalService.Person> listActive() { return people; }
            public boolean canPublish(String id) { return "alice".equals(id); }
            public boolean canAssignApproval(String id) { return "bob".equals(id) || "carol".equals(id); }
        };
    }
    @Bean ActorDirectory actorDirectory() { return demoDirectory(); }
    @Bean(destroyMethod = "close") ApprovalService approvalService(ObjectMapper mapper,
        @Value("${approval.data-file}") String file, ActorDirectory actors) throws IOException {
        return new ApprovalService(mapper, file, actors, ProcessDefinition.legacy("bob"));
    }
}
