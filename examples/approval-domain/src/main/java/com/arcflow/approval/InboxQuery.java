package com.arcflow.approval;

import com.arcflow.approval.ApprovalService.Request;
import java.io.*;
import java.time.Instant;
import java.util.*;

/** Authenticated request-level worklist. A cursor is a position, never an authorization grant. */
public record InboxQuery(String actor, Bucket bucket, String status, Integer processVersion, int limit, Position after) {
    public enum Bucket { PENDING, HANDLED }
    public record Member(String actorId, boolean pending, boolean handled) {}
    public record Position(long seconds, int nanos, String requestId) {
        public Position {
            if (nanos < 0 || nanos > 999_999_999 || requestId == null ||
                    !requestId.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"))
                throw new IllegalArgumentException("Invalid inbox cursor position");
            Instant.ofEpochSecond(seconds, nanos);
        }
    }
    public static final int DEFAULT_LIMIT = 25;
    public static final int MAX_LIMIT = 100;
    public static final Comparator<Request> ORDER = (a, b) -> comparePositions(position(b), position(a));

    public InboxQuery {
        if (!ProcessDefinition.validActorId(actor) || bucket == null || limit < 1 || limit > MAX_LIMIT ||
                (status != null && !Set.of("PENDING", "APPROVED", "REJECTED").contains(status)) ||
                (processVersion != null && processVersion < 1))
            throw new IllegalArgumentException("Invalid inbox actor, bucket, filter or limit");
    }

    public static Position position(Request request) {
        Instant at = Instant.parse(request.createdAt());
        return new Position(at.getEpochSecond(), at.getNano(), request.id());
    }

    /** Chronological ascending comparison; ASCII request IDs break equal-Instant ties. */
    public static int comparePositions(Position a, Position b) {
        int order = Long.compare(a.seconds(), b.seconds());
        if (order == 0) order = Integer.compare(a.nanos(), b.nanos());
        return order == 0 ? a.requestId().compareTo(b.requestId()) : order;
    }

    /** Complete snapshotted participant projection, including future and never-voted members. */
    public static List<Member> members(Request request) {
        Set<String> pending = new HashSet<>(ApprovalService.pendingApproverIds(request));
        Set<String> handled = new HashSet<>();
        request.history().stream().skip(1).forEach(event -> handled.add(event.actorId()));
        return request.definition().approvals().stream().flatMap(node -> node.participants().stream()).distinct()
            .map(actor -> new Member(actor, pending.contains(actor), handled.contains(actor))).toList();
    }

    /** Rechecks exact identity and real votes instead of trusting an index or representative assignee. */
    public boolean matches(Request request) {
        return acceptsFilters(request) && (after == null || comparePositions(position(request), after) < 0) &&
            members(request).stream().anyMatch(member -> actor.equals(member.actorId()) &&
                (bucket == Bucket.PENDING ? member.pending() : member.handled()));
    }

    public boolean acceptsFilters(Request request) {
        return (status == null || status.equals(request.status())) &&
            (processVersion == null || processVersion == request.processVersion());
    }

    public String cursorFor(Request request) {
        try {
            var bytes = new ByteArrayOutputStream();
            try (var out = new DataOutputStream(bytes)) {
                out.writeByte(1); out.writeUTF(actor); out.writeUTF(bucket.name());
                out.writeUTF(status == null ? "" : status); out.writeInt(processVersion == null ? 0 : processVersion);
                Position position = position(request);
                out.writeLong(position.seconds()); out.writeInt(position.nanos()); out.writeUTF(position.requestId());
            }
            return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.toByteArray());
        } catch (IOException impossible) { throw new IllegalStateException(impossible); }
    }

    public static InboxQuery parse(String actor, String box, Integer limit, String status, Integer processVersion, String cursor) {
        Bucket bucket = box == null ? Bucket.PENDING : Bucket.valueOf(box);
        var query = new InboxQuery(actor, bucket, status, processVersion, limit == null ? DEFAULT_LIMIT : limit, null);
        if (cursor == null) return query;
        if (cursor.isEmpty() || cursor.length() > 1024 || !cursor.matches("[A-Za-z0-9_-]+"))
            throw new IllegalArgumentException("Invalid inbox cursor");
        try {
            byte[] bytes = Base64.getUrlDecoder().decode(cursor);
            if (!Base64.getUrlEncoder().withoutPadding().encodeToString(bytes).equals(cursor))
                throw new IllegalArgumentException("Noncanonical inbox cursor");
            try (var input = new DataInputStream(new ByteArrayInputStream(bytes))) {
                if (input.readUnsignedByte() != 1 || !actor.equals(input.readUTF()) || !bucket.name().equals(input.readUTF()) ||
                        !Objects.equals(status == null ? "" : status, input.readUTF()) ||
                        (processVersion == null ? 0 : processVersion) != input.readInt())
                    throw new IllegalArgumentException("Inbox cursor belongs to a different actor or filter");
                Position after = new Position(input.readLong(), input.readInt(), input.readUTF());
                if (input.available() != 0) throw new IllegalArgumentException("Invalid inbox cursor suffix");
                return new InboxQuery(actor, bucket, status, processVersion, query.limit(), after);
            }
        } catch (IOException | java.time.DateTimeException failure) {
            throw new IllegalArgumentException("Invalid inbox cursor", failure);
        }
    }
}
