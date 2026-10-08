package com.arcflow.demo;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import static org.junit.jupiter.api.Assertions.*;

class SecurityConfigTest {
    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"short", "a1234567890", "            "})
    void missingBlankOrShortDemoPasswordsFailClosed(String password) {
        for (String id : List.of("alice", "bob", "carol")) {
            var env = new MockEnvironment();
            for (String other : List.of("alice", "bob", "carol"))
                if (!other.equals(id)) env.setProperty(key(other), other + "-test-password");
            if (password != null) env.setProperty(key(id), password);
            var error = assertThrows(IllegalStateException.class, () -> new SecurityConfig().users(env));
            assertEquals("Set " + key(id) + " to a unique password of at least 12 characters", error.getMessage());
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("acceptedPasswords")
    void validBoundaryPasswordsRemainUsable(String description, String password, int bytes) {
        assertEquals(bytes, password.getBytes(StandardCharsets.UTF_8).length);
        for (String id : List.of("alice", "bob", "carol")) {
            var users = new SecurityConfig().users(validEnvironment().withProperty(key(id), password));
            var user = users.loadUserByUsername(id);
            assertTrue(user.getPassword().startsWith("{bcrypt}"));
            assertTrue(new BCryptPasswordEncoder().matches(password, user.getPassword().substring("{bcrypt}".length())));
            assertTrue(user.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_USER")));
            assertEquals(id.equals("alice"), user.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_EDITOR")));
        }
    }

    static Stream<Arguments> acceptedPasswords() {
        return Stream.of(
            Arguments.of("12 ASCII characters preserve the minimum", "a".repeat(12), 12),
            Arguments.of("32 ASCII characters preserve launcher passwords", "a".repeat(32), 32),
            Arguments.of("72 ASCII bytes are accepted", "a".repeat(72), 72),
            Arguments.of("72 UTF-8 bytes of CJK characters are accepted", "密".repeat(24), 72),
            Arguments.of("72 UTF-8 bytes of supplementary characters are accepted", "🔒".repeat(18), 72));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("oversizedPasswords")
    void oversizedPasswordsIdentifyTheVariableWithoutLeakingTheSecret(String description, String password) {
        assertEquals(73, password.getBytes(StandardCharsets.UTF_8).length);
        for (String id : List.of("alice", "bob", "carol")) {
            var env = validEnvironment().withProperty(key(id), password);
            var error = assertThrows(IllegalStateException.class, () -> new SecurityConfig().users(env));
            assertEquals("Set " + key(id) + " to a password of at most 72 UTF-8 bytes", error.getMessage());
            assertFalse(error.getMessage().contains(password));
            assertNull(error.getCause());
        }
    }

    static Stream<Arguments> oversizedPasswords() {
        return Stream.of(
            Arguments.of("73 ASCII bytes are rejected", "a".repeat(73)),
            Arguments.of("73 UTF-8 bytes of CJK characters are rejected", "密".repeat(24) + "a"),
            Arguments.of("73 UTF-8 bytes of supplementary characters are rejected", "🔒".repeat(18) + "a"));
    }

    private static MockEnvironment validEnvironment() {
        var env = new MockEnvironment();
        for (String id : List.of("alice", "bob", "carol")) env.setProperty(key(id), id + "-test-password");
        return env;
    }

    private static String key(String id) {
        return "APPROVAL_" + id.toUpperCase(Locale.ROOT) + "_PASSWORD";
    }
}
