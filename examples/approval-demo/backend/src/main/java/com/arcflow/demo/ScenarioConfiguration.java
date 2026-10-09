package com.arcflow.demo;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class ScenarioConfiguration {
    /** Registry keys and filenames are compiled constants; request paths never select filesystem paths. */
    @Bean(destroyMethod="close") ScenarioCase expenseScenario(ObjectMapper mapper,ActorDirectory actors,
            @Value("${approval.data-file}") String file) throws IOException {
        var entry=ScenarioCatalog.expense("bob","carol");
        var service=new ApprovalService(mapper,file+".scenario-oa-expense.json",actors,entry.initialProcess());
        try { return new ScenarioCase(entry,service,actors); }
        catch(RuntimeException failure) { service.close(); throw failure; }
    }
    @Bean(destroyMethod="close") ScenarioCase travelScenario(ObjectMapper mapper,ActorDirectory actors,
            @Value("${approval.data-file}") String file) throws IOException {
        var entry=ScenarioCatalog.travel("bob","carol");
        var service=new ApprovalService(mapper,file+".scenario-oa-travel.json",actors,entry.initialProcess());
        try { return new ScenarioCase(entry,service,actors); }
        catch(RuntimeException failure) { service.close(); throw failure; }
    }
    @Bean(destroyMethod="close") ScenarioCase sealUseScenario(ObjectMapper mapper,ActorDirectory actors,
            @Value("${approval.data-file}") String file) throws IOException {
        var entry=ScenarioCatalog.sealUse("bob","carol");
        var service=new ApprovalService(mapper,file+".scenario-oa-seal-use.json",actors,entry.initialProcess());
        try { return new ScenarioCase(entry,service,actors); }
        catch(RuntimeException failure) { service.close(); throw failure; }
    }
    @Bean(destroyMethod="close") ScenarioCase receivingScenario(ObjectMapper mapper,ActorDirectory actors,
            @Value("${approval.data-file}") String file) throws IOException {
        var entry=ScenarioCatalog.receiving("bob","carol","bob");
        var service=new ApprovalService(mapper,file+".scenario-erp-receiving.json",actors,entry.initialProcess());
        try { return new ScenarioCase(entry,service,actors); }
        catch(RuntimeException failure) { service.close(); throw failure; }
    }
    @Bean Map<String,ScenarioCase> scenarioRegistry(
            @Qualifier("expenseScenario") ScenarioCase expenseScenario,
            @Qualifier("travelScenario") ScenarioCase travelScenario,
            @Qualifier("sealUseScenario") ScenarioCase sealUseScenario,
            @Qualifier("receivingScenario") ScenarioCase receivingScenario) {
        return Map.of("oa-expense",expenseScenario,"oa-travel",travelScenario,
            "oa-seal-use",sealUseScenario,"erp-receiving",receivingScenario);
    }
}
