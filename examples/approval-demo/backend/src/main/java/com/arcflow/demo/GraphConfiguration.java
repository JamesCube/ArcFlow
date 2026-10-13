package com.arcflow.demo;

import com.arcflow.approval.ActorDirectory;
import com.arcflow.approval.QuoteDiscountCase;
import com.arcflow.approval.graph.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Configuration
class GraphConfiguration {
    static final class Services implements AutoCloseable {
        final Map<String,GraphApprovalService> values;
        Services(Map<String,GraphApprovalService> values) { this.values=Map.copyOf(values); }
        GraphApprovalService get(String key) {
            var value=values.get(key); if(value==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Unknown graph scenario"); return value;
        }
        @Override public void close() throws IOException {
            IOException failure=null;
            for(var value:values.values()) try { value.close(); } catch(IOException e) { if(failure==null)failure=e;else failure.addSuppressed(e); }
            if(failure!=null)throw failure;
        }
    }
    /** Synthetic, immutable CRM records; no live CRM account or customer changes. Legacy quote source is unchanged. */
    static QuoteDiscountCase.QuoteSource quoteSource() {
        var quotes=List.of("Q-DEMO-001","Q-GRAPH-002","Q-GRAPH-003").stream().map(id ->
            new QuoteDiscountCase.QuoteVersion(id,1,"CUSTOMER-DEMO-A","alice",Set.of("alice","bob","carol"),
                "设备套装 / Equipment set",10,new BigDecimal("1000.00"),"CNY","2099-12-31")).toList();
        return new QuoteDiscountCase.QuoteSource() {
            public Optional<QuoteDiscountCase.QuoteVersion> find(String id,int revision) { return quotes.stream().filter(q->q.businessId().equals(id)&&q.revision()==revision).findFirst(); }
            public int currentRevision(String id) { return quotes.stream().filter(q->q.businessId().equals(id)).mapToInt(QuoteDiscountCase.QuoteVersion::revision).findFirst().orElse(0); }
            public List<QuoteDiscountCase.QuoteVersion> available() { return quotes; }
        };
    }
    /** Fixed adjacent paths: request input can never select a graph store or filesystem path. */
    @Bean(destroyMethod="close") Services graphServices(ObjectMapper mapper,ActorDirectory actors,
            @Value("${approval.data-file}") String file) throws IOException {
        Map<String,GraphApprovalService> services=new LinkedHashMap<>();
        try {
            services.put("payment",create(mapper,file+".graph.json",GraphSamples.payment(),actors,null));
            services.put("travel",create(mapper,file+".travel.graph.json",GraphSamples.travel(),actors,null));
            services.put("receiving",create(mapper,file+".receiving.graph.json",GraphSamples.receiving(),actors,null));
            services.put("quote",create(mapper,file+".quote.graph.json",GraphSamples.quote(),actors,quoteSource()));
            return new Services(services);
        } catch (IOException | RuntimeException failure) {
            for(var value:services.values())try{value.close();}catch(IOException cleanup){failure.addSuppressed(cleanup);} throw failure;
        }
    }
    private static GraphApprovalService create(ObjectMapper mapper,String file,GraphDefinition definition,ActorDirectory actors,QuoteDiscountCase.QuoteSource source) throws IOException {
        var store=new JsonGraphApprovalStore(mapper,file,definition);
        try { return new GraphApprovalService(store,actors,Clock.systemUTC(),source); }
        catch(RuntimeException failure) { try{store.close();}catch(IOException cleanup){failure.addSuppressed(cleanup);}throw failure; }
    }

}
