package com.arcflow.spi;

import com.arcflow.ExecutionEvent;

/** Synchronous observer. Exceptions abort execution; listeners must not throw. */
@FunctionalInterface
public interface EventListener {
    void onEvent(ExecutionEvent event);
}
