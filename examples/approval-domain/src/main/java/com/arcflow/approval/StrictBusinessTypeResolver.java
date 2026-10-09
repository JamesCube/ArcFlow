package com.arcflow.approval;

import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.jsontype.*;
import com.fasterxml.jackson.databind.jsontype.impl.StdTypeResolverBuilder;
import java.io.IOException;
import java.util.Collection;

/** Guard receiving tokens before Jackson buffers fields that precede the type discriminator. */
public final class StrictBusinessTypeResolver extends StdTypeResolverBuilder {
    @Override public TypeDeserializer buildTypeDeserializer(DeserializationConfig config, JavaType type, Collection<NamedType> subtypes) {
        TypeDeserializer delegate = super.buildTypeDeserializer(config, type, subtypes);
        return delegate == null ? null : new Guarded(delegate);
    }
    private static final class Guarded extends TypeDeserializer {
        private final TypeDeserializer delegate;
        private Guarded(TypeDeserializer delegate) { this.delegate = delegate; }
        @Override public TypeDeserializer forProperty(BeanProperty property) { return new Guarded(delegate.forProperty(property)); }
        @Override public JsonTypeInfo.As getTypeInclusion() { return delegate.getTypeInclusion(); }
        @Override public String getPropertyName() { return delegate.getPropertyName(); }
        @Override public TypeIdResolver getTypeIdResolver() { return delegate.getTypeIdResolver(); }
        @Override public Class<?> getDefaultImpl() { return delegate.getDefaultImpl(); }
        @Override public Object deserializeTypedFromObject(JsonParser parser, DeserializationContext context) throws IOException {
            return delegate.deserializeTypedFromObject(ApprovalService.receivingTokenGuard(parser), context);
        }
        @Override public Object deserializeTypedFromArray(JsonParser parser, DeserializationContext context) throws IOException {
            return delegate.deserializeTypedFromArray(ApprovalService.receivingTokenGuard(parser), context);
        }
        @Override public Object deserializeTypedFromScalar(JsonParser parser, DeserializationContext context) throws IOException {
            return delegate.deserializeTypedFromScalar(ApprovalService.receivingTokenGuard(parser), context);
        }
        @Override public Object deserializeTypedFromAny(JsonParser parser, DeserializationContext context) throws IOException {
            return delegate.deserializeTypedFromAny(ApprovalService.receivingTokenGuard(parser), context);
        }
    }
}
