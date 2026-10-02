package com.arcflow.demo;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Local demonstration store. One process holds an exclusive lock; every mutation is serialized. */
@Service
public class ApprovalService implements AutoCloseable {
    public record Person(String id, String displayName) {}
    public record Event(String actorId, String action, String comment, String at) {}
    public record Request(String id, String title, String reason, int days, String applicantId, String approverId,
                          String status, String createdAt, String updatedAt, String decision, String comment,
                          String processId, int processVersion, List<Event> history) {
        public Request { history = List.copyOf(history); }
    }
    public record Snapshot(int schemaVersion, List<Request> requests) {}
    public static final List<Person> PEOPLE = List.of(new Person("alice", "Alice"), new Person("bob", "Bob"), new Person("carol", "Carol"));
    private final ObjectMapper mapper;
    private final Path file;
    private final FileChannel lockChannel;
    private final FileLock lock;
    private Map<String, Request> requests = new LinkedHashMap<>();

    public ApprovalService(ObjectMapper mapper, @Value("${approval.data-file}") String filename) throws IOException {
        this.mapper = mapper;
        this.file = Path.of(filename).toAbsolutePath();
        Files.createDirectories(file.getParent());
        lockChannel = FileChannel.open(file.resolveSibling(file.getFileName() + ".lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        FileLock acquired = null;
        try {
            acquired = lockChannel.tryLock();
            if (acquired == null) throw new IOException("Another process owns the approval data file");
            if (Files.exists(file)) {
                Snapshot snapshot = mapper.readValue(file.toFile(), Snapshot.class);
                if (snapshot.schemaVersion() != 1 || snapshot.requests() == null) throw new IOException("Unsupported or invalid snapshot");
                for (Request r : snapshot.requests()) {
                    if (r.id() == null || r.title() == null || r.reason() == null || r.days() < 1 || r.days() > 365 ||
                        PEOPLE.stream().noneMatch(p -> p.id().equals(r.applicantId())) || !List.of("bob", "carol").contains(r.approverId()) ||
                        r.applicantId().equals(r.approverId()) || !"leave-approval".equals(r.processId()) || r.processVersion() != 1 ||
                        !validHistory(r) || !List.of("PENDING", "APPROVED", "REJECTED").contains(r.status()) || requests.putIfAbsent(r.id(), r) != null)
                        throw new IOException("Invalid snapshot entry");
                }
            }
        } catch (Exception e) {
            if (acquired != null) acquired.release();
            lockChannel.close();
            if (e instanceof IOException io) throw io;
            throw new IOException("Cannot open approval data file", e);
        }
        lock = acquired;
    }
    public synchronized List<Request> list(String actor) {
        return requests.values().stream().filter(r -> r.applicantId().equals(actor) || r.approverId().equals(actor)).toList();
    }
    public synchronized Request submit(String actor, String title, String reason, int days, String approver) throws IOException {
        if (PEOPLE.stream().noneMatch(p -> p.id().equals(actor))) throw forbidden();
        if (!List.of("bob", "carol").contains(approver) || approver.equals(actor))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose another designated approver (bob or carol)");
        var normalized = SubmissionWorkflow.execute(title, reason, days);
        String now = Instant.now().toString();
        Request r = new Request(UUID.randomUUID().toString(), normalized.get("title"), normalized.get("reason"), days, actor, approver,
            "PENDING", now, now, null, null, "leave-approval", 1, List.of(new Event(actor, "SUBMIT", "", now)));
        commit(r); return r;
    }
    public synchronized Request decide(String actor, String id, String decision, String comment) throws IOException {
        Request old = requests.get(id);
        // Conceal existence from unrelated users, and authorize before idempotency lookup.
        if (old == null || (!old.applicantId().equals(actor) && !old.approverId().equals(actor)))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Request not found");
        if (!old.approverId().equals(actor)) throw forbidden();
        if (!List.of("APPROVE", "REJECT").contains(decision)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid decision");
        if (!old.status().equals("PENDING")) {
            if (decision.equals(old.decision())) return old;
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Request already has a different terminal decision");
        }
        String now = Instant.now().toString();
        String cleanComment = comment == null ? "" : comment.trim();
        var history = new ArrayList<>(old.history()); history.add(new Event(actor, decision, cleanComment, now));
        Request next = new Request(old.id(), old.title(), old.reason(), old.days(), old.applicantId(), old.approverId(),
            decision.equals("APPROVE") ? "APPROVED" : "REJECTED", old.createdAt(), now, decision, cleanComment,
            old.processId(), old.processVersion(), List.copyOf(history));
        commit(next); return next;
    }
    private static boolean validHistory(Request r) {
        if (r.createdAt() == null || r.updatedAt() == null || r.history().isEmpty()) return false;
        try { Instant.parse(r.createdAt()); Instant.parse(r.updatedAt()); } catch (RuntimeException ex) { return false; }
        Event first = r.history().get(0);
        if (!"SUBMIT".equals(first.action()) || !r.applicantId().equals(first.actorId()) || !r.createdAt().equals(first.at()) || !"".equals(first.comment())) return false;
        if ("PENDING".equals(r.status())) return r.history().size() == 1 && r.updatedAt().equals(r.createdAt()) && r.decision() == null && r.comment() == null;
        if (r.history().size() != 2 || r.comment() == null) return false;
        Event last = r.history().get(1);
        return r.approverId().equals(last.actorId()) && r.updatedAt().equals(last.at()) &&
            Objects.equals(r.decision(), last.action()) && Objects.equals(r.comment(), last.comment()) &&
            (("APPROVED".equals(r.status()) && "APPROVE".equals(r.decision())) ||
             ("REJECTED".equals(r.status()) && "REJECT".equals(r.decision())));
    }
    private void commit(Request next) throws IOException {
        var updated = new LinkedHashMap<>(requests); updated.put(next.id(), next);
        byte[] json = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(new Snapshot(1, List.copyOf(updated.values())));
        Path temp = Files.createTempFile(file.getParent(), "approval-", ".tmp");
        try {
            try (var channel = FileChannel.open(temp, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)) {
                var buffer = ByteBuffer.wrap(json); while (buffer.hasRemaining()) channel.write(buffer); channel.force(true);
            }
            // No non-atomic fallback: fail closed on unsupported file systems.
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            requests = updated; // Publish only after persistence succeeds.
        } finally { Files.deleteIfExists(temp); }
    }
    private static ResponseStatusException forbidden() { return new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the assigned approver may decide"); }
    @PreDestroy @Override public synchronized void close() throws IOException { if (lock.isValid()) lock.release(); lockChannel.close(); }
}
