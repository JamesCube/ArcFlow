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
    @Bean Map<String,ScenarioCase> scenarioRegistry(@Qualifier("expenseScenario") ScenarioCase expenseScenario,
            @Qualifier("travelScenario") ScenarioCase travelScenario) {
        return Map.of("oa-expense",expenseScenario,"oa-travel",travelScenario);
    }
}
