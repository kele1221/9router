"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal, ConfirmModal, Select } from "@/shared/components";

// Prompt dropdown + inline manager. Built-in presets can be edited (the edit is
// saved as an override and can be reverted); custom prompts can also be deleted.
export default function PromptSelect({ prompts, value, evaluationType = "visual", onChange, onPromptsChanged, showNotice }) {
  const [editing, setEditing] = useState(null); // { id, name, content, builtin }
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmRestore, setConfirmRestore] = useState(null);

  const options = prompts.map((p) => ({
    value: p.id,
    label: `${p.builtin ? (p.overridden ? "内置·已改" : "内置") : "自定义"} · ${p.name}`,
  }));
  const current = prompts.find((p) => p.id === value) || null;

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.content.trim()) {
      showNotice?.("名称与内容都不能为空");
      return;
    }
    setSaving(true);
    try {
      const isNew = !editing.id;
      const url = isNew ? "/api/model-eval/prompts" : `/api/model-eval/prompts/${editing.id}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editing.name, content: editing.content, evaluationType: editing.evaluationType, expectedAnswer: editing.expectedAnswer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      await onPromptsChanged();
      if (isNew && data.prompt?.id) onChange(data.prompt.id);
      showNotice?.(editing.builtin ? "内置 Prompt 已按你的版本保存" : isNew ? "Prompt 已新增" : "Prompt 已更新");
      setEditing(null);
    } catch (err) {
      showNotice?.(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (prompt) => {
    try {
      const res = await fetch(`/api/model-eval/prompts/${prompt.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "删除失败");
      if (value === prompt.id && !prompt.builtin) onChange(prompts.find((p) => p.builtin)?.id || "");
      await onPromptsChanged();
      showNotice?.(prompt.builtin ? "已恢复内置原文" : "Prompt 已删除");
    } catch (err) {
      showNotice?.(err.message);
    } finally {
      setConfirmDelete(null);
      setConfirmRestore(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <Select
          label="测试 Prompt（每次仅可选中一个）"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={options}
          className="flex-1"
        />
        <Button
          size="sm"
          variant="secondary"
          icon="add"
          onClick={() => setEditing({ id: null, name: "", content: "", evaluationType, expectedAnswer: "" })}
        >
          新增
        </Button>
      </div>

      {current && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {current.builtin ? (
              <>
                <span className={`px-2 py-0.5 rounded-[6px] text-[11px] font-medium ${current.overridden ? "bg-amber-500/15 text-amber-500" : "bg-surface-3 text-text-muted"}`}>
                  {current.overridden ? "内置·已按你的版本" : "内置预设"}
                </span>
                <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing({ ...current })}>修改提示词</Button>
                {current.overridden && (
                  <Button size="sm" variant="ghost" icon="restart_alt" onClick={() => setConfirmRestore(current)}>恢复默认</Button>
                )}
              </>
            ) : (
              <>
                <span className="px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-surface-3 text-text-muted">自定义</span>
                <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing({ ...current })}>编辑</Button>
                <Button size="sm" variant="ghost" icon="delete" onClick={() => setConfirmDelete(current)}>删除</Button>
              </>
            )}
          </div>
          <p className="text-[11px] text-text-muted line-clamp-3" title={current.content}>{current.content}</p>
        </div>
      )}

      {editing && (
        <Modal
          isOpen
          onClose={() => setEditing(null)}
          size="lg"
          title={editing.id ? (editing.builtin ? "修改内置 Prompt" : "编辑 Prompt") : "新增 Prompt"}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>取消</Button>
              <Button loading={saving} onClick={save}>保存</Button>
            </>
          )}
        >
          <div className="flex flex-col gap-3">
            {editing.builtin && (
              <p className="text-[11px] text-text-muted">
                内置预设仍然不可删除，你的修改会另存为覆盖版本；随时可以「恢复默认」。
              </p>
            )}
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Prompt 名称"
              className="w-full py-2 px-3 text-sm bg-surface-2 border border-transparent rounded-[10px] text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-text-main">评测类型</p>
              <div className="flex gap-2">
                {[{ value: "visual", label: "可视化代码" }, { value: "arithmetic", label: "算术答题" }].map((type) => (
                  <button key={type.value} type="button" onClick={() => setEditing({ ...editing, evaluationType: type.value, expectedAnswer: type.value === "visual" ? null : editing.expectedAnswer ?? "" })} className={`rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${editing.evaluationType === type.value ? "bg-brand-500/15 text-primary" : "bg-surface-2 text-text-muted hover:text-text-main"}`}>{type.label}</button>
                ))}
              </div>
            </div>
            {editing.evaluationType === "arithmetic" && (
              <input value={editing.expectedAnswer ?? ""} onChange={(e) => setEditing({ ...editing, expectedAnswer: e.target.value })} placeholder="标准答案，例如 10" inputMode="decimal" className="w-full py-2 px-3 text-sm bg-surface-2 border border-transparent rounded-[10px] text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            )}
            <textarea
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              rows={8}
              placeholder="Prompt 内容"
              className="w-full py-2 px-3 text-sm bg-surface-2 border border-transparent rounded-[10px] text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-y"
            />
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen
          variant="danger"
          confirmText="删除"
          title="删除 Prompt"
          message={`确定删除「${confirmDelete.name}」？历史评测记录不受影响。`}
          onConfirm={() => remove(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {confirmRestore && (
        <ConfirmModal
          isOpen
          confirmText="恢复默认"
          title="恢复内置 Prompt"
          message="将丢弃你的修改，恢复成系统内置的提示词原文。"
          onConfirm={() => remove(confirmRestore)}
          onClose={() => setConfirmRestore(null)}
        />
      )}
    </div>
  );
}

PromptSelect.propTypes = {
  prompts: PropTypes.array.isRequired,
  value: PropTypes.string,
  evaluationType: PropTypes.oneOf(["visual", "arithmetic"]),
  onChange: PropTypes.func.isRequired,
  onPromptsChanged: PropTypes.func.isRequired,
  showNotice: PropTypes.func,
};
