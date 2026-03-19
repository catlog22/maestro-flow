import { cn } from '@/client/lib/utils.js';

// ---------------------------------------------------------------------------
// SettingsCard — titled card with optional description
// ---------------------------------------------------------------------------

export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-default)] border border-border bg-bg-secondary p-[var(--spacing-4)]',
        className,
      )}
    >
      <div className="mb-[var(--spacing-3)]">
        <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-text-primary">
          {title}
        </h3>
        {description && (
          <p className="mt-[var(--spacing-1)] text-[length:var(--font-size-xs)] text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsField — label + description + input slot
// ---------------------------------------------------------------------------

export function SettingsField({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-[var(--spacing-4)] py-[var(--spacing-2)]">
      <div className="flex-1 min-w-0">
        <label
          htmlFor={htmlFor}
          className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-primary"
        >
          {label}
        </label>
        {description && (
          <p className="mt-[var(--spacing-0-5)] text-[length:var(--font-size-xs)] text-text-secondary">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsInput — text input
// ---------------------------------------------------------------------------

export function SettingsInput({
  id,
  value,
  onChange,
  placeholder,
  className,
  type = 'text',
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  type?: 'text' | 'password';
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'w-48 px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
        'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-sm)]',
        'focus:outline-none focus:border-accent-blue focus:shadow-[var(--shadow-focus-ring)]',
        'transition-colors duration-[var(--duration-fast)]',
        'placeholder:text-text-tertiary',
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// SettingsSelect — dropdown select
// ---------------------------------------------------------------------------

export function SettingsSelect<T extends string>({
  id,
  value,
  onChange,
  options,
  className,
}: {
  id?: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        'w-48 px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
        'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-sm)]',
        'focus:outline-none focus:border-accent-blue focus:shadow-[var(--shadow-focus-ring)]',
        'transition-colors duration-[var(--duration-fast)]',
        className,
      )}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// SettingsSaveBar — sticky bottom bar with save/discard when dirty
// ---------------------------------------------------------------------------

export function SettingsSaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;

  return (
    <div className="sticky bottom-0 left-0 right-0 flex items-center justify-end gap-[var(--spacing-2)] px-[var(--spacing-4)] py-[var(--spacing-3)] border-t border-border bg-bg-secondary/95 backdrop-blur-sm">
      <button
        type="button"
        onClick={onDiscard}
        disabled={saving}
        className={cn(
          'px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-sm)]',
          'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
          'border border-border text-text-secondary',
          'hover:bg-bg-hover hover:text-text-primary',
          'transition-colors duration-[var(--duration-fast)]',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
      >
        Discard
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className={cn(
          'px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-sm)]',
          'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
          'bg-accent-blue text-white',
          'hover:opacity-90',
          'transition-colors duration-[var(--duration-fast)]',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
      >
        {saving ? 'Saving...' : 'Save changes'}
      </button>
    </div>
  );
}
