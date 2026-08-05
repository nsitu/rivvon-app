<script setup>
import { ref, computed } from "vue";
import { useForwardPropsEmits } from "reka-ui";
import {
  ColorPickerRoot,
  ColorPickerCanvas,
  ColorPickerEyeDropper,
  ColorPickerSliderHue,
  ColorPickerSliderAlpha,
  ColorPickerInputHex,
  ColorPickerInputHSL,
  ColorPickerInputRGB,
  ColorPickerInputHSB,
} from "@vuelor/picker";

import ColorPickerSelect from '@/components/color-picker/ColorPickerSelect.vue';

const INPUTS = {
  Hex: ColorPickerInputHex,
  RGB: ColorPickerInputRGB,
  HSL: ColorPickerInputHSL,
  HSB: ColorPickerInputHSB,
};

const PICKER_UI = {
  picker: {
    root: "w-full !bg-[#1f2937] !shadow-none rounded-[13px] p-4 flex flex-col gap-2 !text-[#f9fafb]",
  },
  dropper: {
    root: "text-[#e5e7eb] enabled:hover:bg-white/10 disabled:opacity-50 rounded-[5px] focus-within:outline-1 focus-within:outline-[#10b981] p-1",
  },
  shared: {
    thumb: "block w-4 h-4 rounded-full border-4 border-[#1f2937] shadow-vuelor-thumb focus:outline-1 outline-[#10b981]",
  },
  canvas: {
    root: "relative w-full h-52 touch-none rounded-[5px] shadow-vuelor-inner data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  },
  slider: {
    root: "relative h-4 w-full flex items-center select-none touch-none data-[orientation=vertical]:h-auto data-[orientation=vertical]:w-4 data-[orientation=vertical]:flex-col",
    track: "relative h-4 w-full shadow-vuelor-inner grow rounded-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-4",
  },
  input: {
    group: "w-full flex gap-[1px] rounded-[5px] hover:outline-1 outline-[#4b5563] focus-within:outline-1 focus-within:outline-[#10b981] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[disabled]:outline-none",
    item: "flex flex-1 data-[before]:grow-0 data-[alpha-input]:grow-0 items-center px-1 gap-1 !bg-[#374151] !text-[#f9fafb] first:rounded-l-[5px] last:rounded-r-[5px]",
    label: "hidden",
    field: "w-full min-w-5 h-6 text-[11px] !text-[#f9fafb] !bg-transparent focus:outline-none",
  },
};

const props = defineProps({
  class: { type: String, required: false },
  disabled: { type: Boolean, required: false },
  defaultValue: { type: String, required: false },
  modelValue: { type: [String, Object, null], required: false },
  format: { type: String, required: false },
});
const emits = defineEmits(["valueCommit", "update:modelValue"]);

const forwarded = useForwardPropsEmits(props, emits);

const format = ref("Hex");
const formatOptions = ["Hex", "RGB", "HSL", "HSB"];
const canvasType = computed(() => {
  return format.value === "HSL" ? "HSL" : "HSV";
});
</script>

<template>
  <ColorPickerRoot :ui="PICKER_UI" v-bind="forwarded">
    <ColorPickerCanvas :type="canvasType" />
    <div class="flex items-center gap-3">
      <ColorPickerEyeDropper type="button" aria-label="Pick color from screen">
        <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M17.52 6.471a1.62 1.62 0 0 0-2.295.003l-1.87 1.88-.354.355-.355-.354-.01-.01a.9.9 0 0 0-1.272 0l-.02.02a.9.9 0 0 0 0 1.273l.51.51 2 2 .51.51a.9.9 0 0 0 1.272 0l.02-.02a.9.9 0 0 0 0-1.273l-.01-.01-.352-.353.351-.353 1.879-1.888a1.62 1.62 0 0 0-.003-2.29m-3.004-.702a2.621 2.621 0 1 1 3.717 3.697l-1.57 1.579a1.9 1.9 0 0 1-.3 2.3l-.02.02a1.9 1.9 0 0 1-2.687 0l-.156-.157-5.647 5.642a.5.5 0 0 1-.353.147H5.504a.5.5 0 0 1-.5-.5L5 16.503a.5.5 0 0 1 .146-.354l5.647-5.647-.157-.156a1.9 1.9 0 0 1 0-2.687l.02-.02a1.9 1.9 0 0 1 2.299-.3zm-3.016 5.44 1.293 1.292-5.5 5.496h-1.29L6 16.707z"
          />
        </svg>
      </ColorPickerEyeDropper>
      <div class="flex flex-col flex-1 gap-2">
        <ColorPickerSliderHue />
        <ColorPickerSliderAlpha />
      </div>
    </div>
    <div class="flex items-center gap-2">
      <ColorPickerSelect
        v-model="format"
        class="w-[56px]"
        label="Color Format"
        placeholder="Format"
        :disabled="props.disabled"
        :options="formatOptions"
      />
      <component :is="INPUTS[format]" />
    </div>
  </ColorPickerRoot>
</template>
