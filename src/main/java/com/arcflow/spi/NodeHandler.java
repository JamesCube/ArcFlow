package com.arcflow.spi;

import com.arcflow.Node;
import java.util.Map;

/** Returns non-null variable updates. Inputs are immutable snapshots. */
@FunctionalInterface
public interface NodeHandler {
    Map<String, String> execute(Node node, Map<String, String> variables) throws Exception;
}
