function Field({ as: Element = "input", label, name, error, hint, required = false, className = "", ...props }) {
  const inputClass = [
    "w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500",
    error ? "border-red-500 focus:ring-red-500" : "",
    props.disabled ? "bg-gray-100 cursor-not-allowed opacity-60" : "",
    className,
  ].filter(Boolean).join(" ");
  return <div className="mb-4">{label && <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-600">*</span>}</label>}<Element id={name} name={name} className={inputClass} required={required} {...props} />{error && <span className="text-red-600 text-sm mt-1">{error}</span>}{hint && <span className="text-gray-500 text-sm mt-1">{hint}</span>}</div>;
}

/** Reusable labeled input field. */
export function FormField(props) { return <Field {...props} />; }
/** Reusable labeled textarea field. */
export function TextAreaField({ rows = 3, ...props }) { return <Field as="textarea" rows={rows} {...props} />; }
