package com.arcflow.demo;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password", "APPROVAL_BOB_PASSWORD=test-bob-password", "APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
class ApprovalApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @DynamicPropertySource static void data(DynamicPropertyRegistry r) throws Exception {
        var file = Files.createTempDirectory("approval-api-test-").resolve("state.json");
        r.add("approval.data-file", file::toString);
    }
    @Test void authenticationValidationAuthorizationAndCsrf() throws Exception {
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me").with(httpBasic("alice", "wrong"))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me").with(httpBasic("alice", "test-alice-password"))).andExpect(status().isOk()).andExpect(jsonPath("$.id").value("alice"));
        String body = "{\"title\":\"Leave\",\"reason\":\"Rest\",\"days\":2,\"approverId\":\"bob\"}";
        mvc.perform(post("/api/requests").with(httpBasic("alice", "test-alice-password")).contentType("application/json").content(body)).andExpect(status().isForbidden());
        mvc.perform(post("/api/requests").with(httpBasic("alice", "test-alice-password")).header("X-Arcflow-Client", "approval-demo").header("Origin", "https://evil.example").contentType("application/json").content(body)).andExpect(status().isForbidden());
        mvc.perform(post("/api/requests").with(httpBasic("alice", "test-alice-password")).header("X-Arcflow-Client", "approval-demo").contentType("application/json").content(body.replace("\"days\":2", "\"days\":0"))).andExpect(status().isBadRequest());
        mvc.perform(post("/api/requests").with(httpBasic("alice", "test-alice-password")).header("X-Arcflow-Client", "approval-demo").contentType("application/json").content(body.replace("\"days\":2", "\"applicantId\":\"bob\",\"days\":2"))).andExpect(status().isBadRequest());
        mvc.perform(post("/api/requests").with(httpBasic("alice", "test-alice-password")).header("X-Arcflow-Client", "approval-demo").contentType("application/json").content(body.replace("\"days\":2", "\"days\":1.9"))).andExpect(status().isBadRequest());
        var result = mvc.perform(post("/api/requests").with(httpBasic("alice", "test-alice-password")).header("X-Arcflow-Client", "approval-demo").contentType("application/json").content(body)).andExpect(status().isCreated()).andExpect(jsonPath("$.applicantId").value("alice")).andReturn();
        String id = mapper.readTree(result.getResponse().getContentAsString()).get("id").asText();
        mvc.perform(get("/api/requests").with(httpBasic("carol", "test-carol-password"))).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(post("/api/requests/"+id+"/decisions").with(httpBasic("alice", "test-alice-password")).header("X-Arcflow-Client", "approval-demo").contentType("application/json").content("{\"decision\":\"APPROVE\"}")).andExpect(status().isForbidden());
        mvc.perform(post("/api/requests/"+id+"/decisions").with(httpBasic("bob", "test-bob-password")).header("X-Arcflow-Client", "approval-demo").contentType("application/json").content("{\"decision\":\"APPROVE\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("APPROVED")).andExpect(jsonPath("$.history.length()").value(2));
    }
}
