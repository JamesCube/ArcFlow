package com.arcflow.demo;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
class SecurityConfig {
    @Bean UserDetailsService users(Environment env) {
        var encoder = new BCryptPasswordEncoder();
        var users = new InMemoryUserDetailsManager();
        for (String id : List.of("alice", "bob", "carol")) {
            String key = "APPROVAL_" + id.toUpperCase(java.util.Locale.ROOT) + "_PASSWORD";
            String password = env.getProperty(key);
            if (password == null || password.isBlank() || password.length() < 12)
                throw new IllegalStateException("Set " + key + " to a unique password of at least 12 characters");
            if (password.getBytes(StandardCharsets.UTF_8).length > 72)
                throw new IllegalStateException("Set " + key + " to a password of at most 72 UTF-8 bytes");
            users.createUser(User.withUsername(id).password("{bcrypt}" + encoder.encode(password)).roles("alice".equals(id) ? new String[]{"USER", "EDITOR"} : new String[]{"USER"}).build());
        }
        return users;
    }
    @Bean SecurityFilterChain security(HttpSecurity http, @Value("${approval.ui-origin}") String origin) throws Exception {
        return http.csrf(csrf -> csrf.disable()) // Custom non-simple header + strict Origin/Fetch-Metadata checks below.
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .requestCache(c -> c.disable()).formLogin(f -> f.disable()).logout(l -> l.disable())
            .httpBasic(b -> b.authenticationEntryPoint((req, res, e) -> error(res, 401, "Authentication required")))
            .exceptionHandling(e -> e.authenticationEntryPoint((req, res, ex) -> error(res, 401, "Authentication required"))
                .accessDeniedHandler((req, res, ex) -> error(res, 403, "Forbidden")))
            .authorizeHttpRequests(a -> a.requestMatchers(HttpMethod.POST, "/api/process").hasRole("EDITOR")
                .requestMatchers("/api/**").authenticated().anyRequest().denyAll())
            .addFilterBefore(new OncePerRequestFilter() {
                @Override protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
                    String requestOrigin = req.getHeader("Origin");
                    String site = req.getHeader("Sec-Fetch-Site");
                    boolean unsafe = !List.of("GET", "HEAD", "OPTIONS").contains(req.getMethod());
                    if ("cross-site".equals(site) || (requestOrigin != null && !origin.equals(requestOrigin)) ||
                        (unsafe && !"approval-demo".equals(req.getHeader("X-Arcflow-Client")))) {
                        error(res, 403, "Origin or client header rejected"); return;
                    }
                    chain.doFilter(req, res);
                }
            }, BasicAuthenticationFilter.class).build();
    }
    static void error(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status); response.setContentType("application/json");
        response.getWriter().write("{\"message\":\"" + message + "\"}");
    }
}
