"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, ModelSelectModal } from "@/shared/components";

// Multi-select over the same picker the combo editor uses: combos and models of
// connected providers only (ModelSelectModal already drops disabled models and
// combos that have nothing left to route to).
export default function ModelSelector({ selected, onChange, activeProviders, modelAliases, title = "添加模型或组合", maxHeight = 180 }) {
  const [open, setOpen] = useState(false);

  const add = (model) => {
    const value = model?.value || model?.name || model;
    if (!value || selected.includes(value)) return;
    onChange([...selected, value]);
  };

  const remove = (model) => {
    const value = model?.value || model?.name || model;
    onChange(selected.filter((v) => v !== value));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon="add" onClick={() => setOpen(true)}>{title}</Button>
        {selected.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange([])}>清空</Button>
        )}
        <span className="text-[11px] text-text-muted">
          已选 {selected.length} 项{selected.length > 1 ? "（并行执行）" : ""}
        </span>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 overflow-y-auto custom-scrollbar" style={{ maxHeight }}>
          {selected.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-[8px] bg-surface-2 text-[11px] font-mono text-text-main"
              title={value}
            >
              <span className="max-w-[220px] truncate">{value}</span>
              <button
                type="button"
                onClick={() => remove(value)}
                className="text-text-muted hover:text-red-500 transition-colors"
                aria-label={`移除 ${value}`}
              >
                <span className="material-symbols-outlined text-[12px] leading-none block">close</span>
              </button>
            </span>
          ))}
        </div>
      )}

      <ModelSelectModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onSelect={add}
        onDeselect={remove}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={selected}
        closeOnSelect={false}
        title={title}
      />
    </div>
  );
}

ModelSelector.propTypes = {
  selected: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
  activeProviders: PropTypes.array,
  modelAliases: PropTypes.object,
  title: PropTypes.string,
  maxHeight: PropTypes.number,
};
