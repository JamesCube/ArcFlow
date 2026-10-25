package com.ruoyi.arcflow;

import com.ruoyi.common.core.domain.AjaxResult;
import java.io.IOException;
import java.io.UncheckedIOException;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@Order(-100)
@RestControllerAdvice(assignableTypes = {ArcFlowController.class, ArcFlowGraphController.class})
public class ArcFlowErrors {
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<AjaxResult> status(ResponseStatusException ex) {
        return ResponseEntity.status(ex.getStatusCode()).body(AjaxResult.error(ex.getStatusCode().value(), ex.getReason()));
    }
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<AjaxResult> malformed(HttpMessageNotReadableException ex) {
        return ResponseEntity.badRequest().body(AjaxResult.error(400, "Invalid request body"));
    }
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<AjaxResult> invalid(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(AjaxResult.error(400, "Invalid graph request"));
    }
    @ExceptionHandler(UncheckedIOException.class)
    public ResponseEntity<AjaxResult> uncheckedStorage(UncheckedIOException ex) { return storage(ex.getCause()); }
    @ExceptionHandler(IOException.class)
    public ResponseEntity<AjaxResult> storage(IOException ex) {
        return ResponseEntity.status(503).body(AjaxResult.error(503, "Storage unavailable; refresh before retrying"));
    }
}
