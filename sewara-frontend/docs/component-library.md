# Shared UI Component Library

Reusable UI components use existing `rp-*` classes.

## Import

```javascript
import { Button, Modal, FormField, LoadingSpinner, EmptyState, ErrorState } from "@/components/ui";
```

## Examples

```jsx
<Button variant="primary" onClick={handleClick}>Simpan</Button>
<Button variant="success" loading={isSaving}>Memproses...</Button>

<Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Konfirmasi">
  <p>Apakah Anda yakin?</p>
</Modal>

<FormField label="Nama" name="nama" value={form.nama} onChange={handleChange} required />
{loading && <LoadingSpinner message="Memuat data..." />}
{!loading && data.length === 0 && <EmptyState message="Belum ada transaksi" />}
{error && <ErrorState message={error} onRetry={fetchData} />}
```
