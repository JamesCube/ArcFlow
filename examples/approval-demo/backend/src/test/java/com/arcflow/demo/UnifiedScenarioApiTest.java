package com.arcflow.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.springframework.test.web.servlet.MockMvc;

/** Composition contract: all four independently stored hosts exist in one application context. */
@SpringBootTest(properties={"APPROVAL_ALICE_PASSWORD=test-alice-password","APPROVAL_BOB_PASSWORD=test-bob-password","APPROVAL_CAROL_PASSWORD=test-carol-password"})
@AutoConfigureMockMvc
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class UnifiedScenarioApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    static Path dataFile;
    @DynamicPropertySource static void data(DynamicPropertyRegistry registry) throws Exception {
        dataFile=Files.createTempDirectory("unified-scenario-api-").resolve("state.json");
        registry.add("approval.data-file",dataFile::toString);
    }
    JsonNode read(String path) throws Exception {
        return mapper.readTree(mvc.perform(get(path).with(httpBasic("alice","test-alice-password")))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    @Test void fourOrderedCatalogEntriesUseSeparateTypedStoresAndRejectEveryCrossHostPayload() throws Exception {
        var ids=List.of("erp-receiving","oa-expense","oa-seal-use","oa-travel");
        var catalog=read("/api/scenarios"); var actual=new ArrayList<String>(); catalog.forEach(item->actual.add(item.path("id").asText()));
        assertEquals(ids,actual); assertEquals(catalog,read("/api/scenarios"));
        var documents=List.of(
            """
            {"type":"receiving","documentVersion":1,"businessId":"GR-MIX","title":"Receipt","reason":"Synthetic PO only","purchaseOrderRef":"PO-MIX","warehouse":"EAST","receivedOn":"2026-10-09","lines":[{"lineId":"line-1","orderLineRef":"PO-L1","description":"Sensors","unit":"PCS","ordered":10,"received":5,"accepted":4,"rejected":1,"exceptionReason":"Synthetic damage"}]}
            """,
            """
            {"type":"expense","documentVersion":1,"businessId":"EXP-MIX","title":"Expense","reason":"Synthetic receipts","costCenter":"OPERATIONS","currency":"CNY","lines":[{"lineId":"line-1","spentOn":"2026-10-01","category":"OFFICE","description":"Supplies","amount":0.10,"receiptRef":"RECEIPT-1"}]}
            """,
            """
            {"type":"sealUse","documentVersion":1,"businessId":"SEAL-MIX","title":"Seal review","reason":"Review only","documentName":"Synthetic document","documentRef":"DOC-MIX","sealType":"OFFICIAL","copyCount":2}
            """,
            """
            {"type":"travel","documentVersion":1,"businessId":"TRIP-MIX","title":"Travel review","reason":"Synthetic itinerary","destination":"Shanghai","startDate":"2026-10-08","endDate":"2026-10-10","purpose":"CUSTOMER_VISIT","estimatedCost":1234.50,"currency":"CNY","costCenter":"SALES"}
            """);
        var schemas=List.of(10,7,9,8); var saved=new ArrayList<JsonNode>();
        for(int i=0;i<ids.size();i++) {
            String route="/api/scenarios/"+ids.get(i); var business=mapper.readTree(documents.get(i));
            var body=mapper.createObjectNode().put("processVersion",1).set("business",business);
            // Keys are local to these separate JSON stores; the JDBC contract separately enforces DB-global keys.
            var created=mapper.readTree(mvc.perform(post(route+"/documents").with(httpBasic("alice","test-alice-password"))
                .header("X-Arcflow-Client","approval-demo").header("Idempotency-Key","same-key-separate-files")
                .contentType("application/json").content(body.toString())).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
            saved.add(created); assertEquals(ids.get(i),created.path("request").path("processId").asText());
            var keys=new java.util.HashSet<String>(); created.fieldNames().forEachRemaining(keys::add);
            assertEquals(i==0?java.util.Set.of("request","total","summary"):java.util.Set.of("request","total"),keys);
            assertEquals(i==0||i==2,created.path("total").isNull());
            Path file=Path.of(dataFile+".scenario-"+ids.get(i)+".json"); assertTrue(Files.exists(file));
            assertEquals(schemas.get(i).intValue(),mapper.readTree(Files.readString(file)).path("schemaVersion").asInt());
            for(int j=0;j<ids.size();j++) if(i!=j) {
                mvc.perform(post("/api/scenarios/"+ids.get(j)+"/documents").with(httpBasic("alice","test-alice-password"))
                    .header("X-Arcflow-Client","approval-demo").header("Idempotency-Key","cross-host")
                    .contentType("application/json").content(body.toString())).andExpect(status().isBadRequest());
            }
        }
        assertEquals(4,saved.stream().map(item->item.path("request").path("id").asText()).distinct().count());
        for(int i=0;i<ids.size();i++) assertEquals(mapper.createArrayNode().add(saved.get(i)),read("/api/scenarios/"+ids.get(i)+"/requests"));
        assertTrue(read("/api/requests").isEmpty());
    }
}
