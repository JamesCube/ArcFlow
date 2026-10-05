import { defineComponent, h } from "vue";
// H5-only native controls: uni-H5's uni-button wrapper is not a keyboard button.
// App / mini-program controls require a separately verified runtime adapter.
export const H5Button = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () =>
      h(
        "button",
        { ...attrs, type: "button", class: ["native-button", attrs.class] },
        slots.default?.(),
      );
  },
});
export const H5Input = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" }, password: Boolean },
  emits: ["update:modelValue", "confirm"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        type: props.password ? "password" : attrs.type || "text",
        value: props.modelValue,
        onInput: (event: Event) =>
          emit("update:modelValue", (event.target as HTMLInputElement).value),
        onKeydown: (event: KeyboardEvent) => {
          if (event.key === "Enter") emit("confirm");
        },
      });
  },
});
export const H5Textarea = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("textarea", {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) =>
          emit(
            "update:modelValue",
            (event.target as HTMLTextAreaElement).value,
          ),
      });
  },
});

export const H5Label = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h("label", attrs, slots.default?.());
  },
});
