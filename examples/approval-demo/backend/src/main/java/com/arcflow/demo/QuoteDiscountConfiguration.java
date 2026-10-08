package com.arcflow.demo;

import com.arcflow.approval.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Local synthetic data only. This does not connect to a CRM account. */
@Configuration
class QuoteDiscountConfiguration {
    @Bean(destroyMethod = "close") QuoteDiscountCase quoteDiscountCase(ObjectMapper mapper, ActorDirectory actors,
            @Value("${approval.data-file}") String file) throws IOException {
        var quote = new QuoteDiscountCase.QuoteVersion("Q-DEMO-001", 1, "CUSTOMER-DEMO-A", "alice",
            Set.of("alice", "bob", "carol"), "设备套装 / Equipment set", 10, new BigDecimal("1000.00"), "CNY", "2099-12-31");
        var source = new QuoteDiscountCase.QuoteSource() {
            public Optional<QuoteDiscountCase.QuoteVersion> find(String id, int revision) {
                return quote.businessId().equals(id) && quote.revision() == revision ? Optional.of(quote) : Optional.empty();
            }
            public int currentRevision(String id) { return quote.businessId().equals(id) ? quote.revision() : 0; }
            public List<QuoteDiscountCase.QuoteVersion> available() { return List.of(quote); }
        };
        var service = new ApprovalService(mapper, file + ".quotes.json", actors, QuoteDiscountCase.definition("bob", "carol"));
        try { return new QuoteDiscountCase(service, actors, source, Clock.systemUTC()); }
        catch (RuntimeException failure) { service.close(); throw failure; }
    }
}
