package com.arcflow.demo;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SecurityConfigTest {
    @Test void missingOrShortDemoPasswordsFailClosed() {
        var config = new SecurityConfig();
        assertThrows(IllegalStateException.class, () -> config.users(new MockEnvironment()));
        assertThrows(IllegalStateException.class, () -> config.users(new MockEnvironment().withProperty("APPROVAL_ALICE_PASSWORD", "short")));
    }
}
