package com.arcflow.demo;

import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class JsonConfig {
    @Bean Jackson2ObjectMapperBuilderCustomizer strictJson() {
        return builder -> builder.postConfigurer(ApprovalService::strictMapper);
    }
}
