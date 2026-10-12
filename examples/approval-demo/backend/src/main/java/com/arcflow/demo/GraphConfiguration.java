package com.arcflow.demo;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.graph.GraphApprovalService;
import com.arcflow.approval.graph.GraphSamples;
import com.arcflow.approval.graph.JsonGraphApprovalStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class GraphConfiguration {
    /** Fixed, adjacent path: request input can never select a graph store or filesystem path. */
    @Bean(destroyMethod="close") GraphApprovalService graphApprovalService(ObjectMapper mapper,ActorDirectory actors,
            @Value("${approval.data-file}") String file) throws IOException {
        return new GraphApprovalService(new JsonGraphApprovalStore(mapper,file+".graph.json",GraphSamples.payment()),actors);
    }
}
