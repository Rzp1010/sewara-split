package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/auth"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

func (s *Server) handleManajemenGet(w http.ResponseWriter, r *http.Request, u db.Identity) {
	m, e := s.db.ManajemenCounts(r.Context())
	if e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal membaca manajemen.")
		return
	}
	writeSuccess(w, 200, map[string]any{"manajemen": m})
}
func (s *Server) handleAdminUsersGet(w http.ResponseWriter, r *http.Request, u db.Identity) {
	if u.Role != "owner" && u.Role != "superadmin" {
		writeError(w, 403, CodeForbidden, "FORBIDDEN")
		return
	}
	v, e := s.db.AdminUsers(r.Context(), u)
	if e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal membaca user.")
		return
	}
	writeSuccess(w, 200, map[string]any{"users": v})
}
func (s *Server) handleAdminLogsGet(w http.ResponseWriter, r *http.Request, u db.Identity) {
	if u.Role != "superadmin" {
		writeError(w, 403, CodeForbidden, "FORBIDDEN")
		return
	}
	v, e := s.db.ListAdminLogs(r.Context(), u.UserID)
	if e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal membaca log admin.")
		return
	}
	writeSuccess(w, 200, map[string]any{"logs": v})
}

type adminBody map[string]json.RawMessage

func decodeAdmin(r *http.Request) (adminBody, error) {
	var b adminBody
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	e := d.Decode(&b)
	return b, e
}
func str(b adminBody, k string) string  { var v string; _ = json.Unmarshal(b[k], &v); return v }
func integer(b adminBody, k string) int { var v int; _ = json.Unmarshal(b[k], &v); return v }
func bad(w http.ResponseWriter, msg string) {
	writeValidationError(w, "Input tidak valid.", map[string]any{"_errors": []string{msg}})
}
func (s *Server) handleAdminUsersPost(w http.ResponseWriter, r *http.Request, u db.Identity) {
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		bad(w, "Request body harus JSON yang valid.")
		return
	}
	role := str(raw, "role")
	if u.Role == "superadmin" && role != "owner" {
		writeError(w, 403, CodeForbidden, "Superadmin hanya bisa membuat akun Owner.")
		return
	}
	if u.Role == "owner" && role == "owner" {
		writeError(w, 403, CodeForbidden, "Owner tidak bisa membuat owner lain.")
		return
	}
	if u.Role != "owner" && u.Role != "superadmin" {
		writeError(w, 403, CodeForbidden, "Akun Anda tidak berhak menambah user.")
		return
	}
	var b struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"nama_lengkap"`
		Username string `json:"username"`
		Invoice  string `json:"nama_invoice"`
		Role     string `json:"role"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(mustRaw(raw))))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&b); err != nil {
		bad(w, "Field tidak dikenal.")
		return
	}
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	b.Name = strings.TrimSpace(b.Name)
	if _, e := mail.ParseAddress(b.Email); e != nil || strings.ContainsAny(b.Email, " <>\t\n") || len(b.Password) < 8 || len(b.Name) < 1 || len(b.Name) > 100 || len(b.Username) > 50 || len(b.Invoice) > 100 || (b.Role != "owner" && b.Role != "cs" && b.Role != "gudang") {
		bad(w, "Input tidak valid.")
		return
	}
	hash, e := auth.HashPassword(b.Password)
	if e != nil {
		writeError(w, 500, CodeInternalError, "Gagal membuat akun.")
		return
	}
	id, e := s.db.CreateAuthUser(r.Context(), b.Email, hash)
	if e != nil {
		writeError(w, 500, CodeInternalError, "Gagal membuat akun.")
		return
	}
	owner := (*string)(nil)
	if u.Role == "owner" {
		owner = &u.UserID
	}
	username := b.Username
	if username == "" {
		username = b.Email
	}
	invoice := b.Invoice
	if invoice == "" {
		invoice = b.Name
	}
	if e = s.db.CreateAdminProfile(r.Context(), u.UserID, id, b.Email, b.Role, b.Name, username, invoice, owner); e != nil {
		writeError(w, 500, CodeInternalError, "Akun dibuat, tapi profil gagal disimpan.")
		return
	}
	s.db.LogAdminAction(r.Context(), u.Email, "tambah_user", b.Email, "role="+b.Role)
	writeSuccess(w, 200, map[string]any{"ok": true})
}
func mustRaw(m map[string]json.RawMessage) []byte { b, _ := json.Marshal(m); return b }
func (s *Server) handleAdminUsersDelete(w http.ResponseWriter, r *http.Request, u db.Identity) {
	b, e := decodeAdmin(r)
	if e != nil {
		bad(w, "Input tidak valid.")
		return
	}
	email := strings.ToLower(strings.TrimSpace(str(b, "email")))
	if len(b) != 1 || email == "" {
		bad(w, "Email wajib diisi.")
		return
	}
	if _, e = mail.ParseAddress(email); e != nil {
		bad(w, "Format email tidak valid.")
		return
	}
	if u.Role != "owner" && u.Role != "superadmin" {
		writeError(w, 403, CodeForbidden, "Akun Anda tidak berhak menghapus user.")
		return
	}
	t, e := s.db.AdminProfileByEmailSystem(r.Context(), email)
	if e == db.ErrNotFound {
		writeError(w, 404, CodeNotFound, "Akun tidak ditemukan.")
		return
	}
	if e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal mencari profil target.")
		return
	}
	if t.Role == "superadmin" {
		writeError(w, 403, CodeForbidden, "Tidak bisa menghapus superadmin.")
		return
	}
	if u.Role != "superadmin" && (t.OwnerID == nil || *t.OwnerID != u.UserID) {
		writeError(w, 404, CodeNotFound, "Akun tidak ditemukan.")
		return
	}
	if t.UserID == u.UserID {
		writeError(w, 403, CodeForbidden, "Tidak bisa menghapus akun sendiri.")
		return
	}
	ids, e := s.db.StaffIDs(r.Context(), u.UserID, t.UserID)
	if e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal menghapus data akun.")
		return
	}
	ids = append(ids, t.UserID)
	e = s.db.DeleteUserData(r.Context(), u.UserID, email, ids)
	if e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal menghapus data akun.")
		return
	}
	n, e := s.db.DeleteAuthUsers(r.Context(), ids)
	if e != nil || n < int64(len(ids)) {
		gagal := int64(len(ids)) - n
		writeError(w, 500, CodeDatabaseError, fmt.Sprintf("Data akun sudah dihapus, tapi %d login gagal dibersihkan. Hubungi admin.", gagal))
		return
	}
	s.db.LogAdminAction(r.Context(), u.Email, "hapus_akun", email, fmt.Sprintf("termasuk %d staf", len(ids)-1))
	writeSuccess(w, 200, map[string]any{"dihapus": n})
}
func (s *Server) handleAdminUsersPatch(w http.ResponseWriter, r *http.Request, u db.Identity) {
	var b map[string]json.RawMessage
	if e := json.NewDecoder(r.Body).Decode(&b); e != nil {
		bad(w, "Request body harus JSON yang valid.")
		return
	}
	email := strings.ToLower(strings.TrimSpace(str(b, "email")))
	action := str(b, "action")
	if email == "" || !knownAction(action) {
		bad(w, "Input tidak valid.")
		return
	}
	t, e := s.db.AdminProfileByEmailSystem(r.Context(), email)
	if e == db.ErrNotFound {
		writeError(w, 404, CodeNotFound, "Akun tidak ditemukan.")
		return
	}
	if e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal mencari profil target.")
		return
	}
	if t.Role == "superadmin" {
		writeError(w, 403, CodeForbidden, "Tidak bisa mengedit superadmin.")
		return
	}
	if u.Role != "superadmin" && (u.Role != "owner" || ((t.OwnerID == nil || *t.OwnerID != u.UserID) && t.UserID != u.UserID)) {
		writeError(w, 404, CodeNotFound, "Akun tidak ditemukan.")
		return
	}
	fail := func(msg string) { writeError(w, 500, CodeDatabaseError, msg) }
	upd := func(field string, v any, msg string) bool {
		if e := s.db.AdminUpdate(r.Context(), u.UserID, email, field, v); e != nil {
			fail(msg)
			return false
		}
		return true
	}
	role := str(b, "role")
	switch action {
	case "set_role":
		if role == "" {
			bad(w, "Role wajib diisi.")
			return
		}
		// Daftar putih sama dengan zod Next (lib/api/validation.ts) dan
		// rpc_set_role; tanpa ini `role:"superadmin"` bisa diberikan lewat API.
		if role != "owner" && role != "cs" && role != "gudang" {
			bad(w, "Role tidak valid.")
			return
		}
		if t.UserID == u.UserID {
			writeError(w, 403, CodeForbidden, "Anda tidak bisa mengubah role sendiri.")
			return
		}
		if role == "owner" && u.Role != "superadmin" {
			writeError(w, 403, CodeForbidden, "Hanya Superadmin yang bisa memberi role owner.")
			return
		}
		if !upd("role", role, "Gagal mengubah role.") {
			return
		}
		s.db.LogAdminAction(r.Context(), u.Email, "set_role", email, "role="+role)
	case "toggle_active":
		if t.UserID == u.UserID {
			writeError(w, 403, CodeForbidden, "Anda tidak bisa menonaktifkan akun sendiri.")
			return
		}
		if t.Role == "owner" && u.Role != "superadmin" {
			writeError(w, 403, CodeForbidden, "Hanya Superadmin yang bisa mengubah status Owner.")
			return
		}
		v := !t.Active
		if !upd("is_active", v, "Gagal mengubah status akun.") {
			return
		}
		s.db.LogAdminAction(r.Context(), u.Email, "toggle_active", email, map[bool]string{true: "diaktifkan", false: "dinonaktifkan"}[v])
		writeSuccess(w, 200, map[string]any{"ok": true, "is_active": v})
		return
	case "setujui_registrasi", "tolak_registrasi", "perpanjang_langganan":
		if u.Role != "superadmin" {
			writeError(w, 403, CodeForbidden, "Hanya Superadmin yang bisa melakukan aksi ini.")
			return
		}
		if t.Role != "owner" {
			writeError(w, 403, CodeForbidden, "Aksi ini hanya untuk akun Owner.")
			return
		}
		dur := integer(b, "durasi")
		if action != "tolak_registrasi" && (dur != 1 && dur != 3 && dur != 6 && dur != 12) {
			bad(w, "Durasi langganan tidak valid (1/3/6/12 bulan).")
			return
		}
		if action == "setujui_registrasi" {
			until := time.Now().AddDate(0, dur, 0)
			for _, x := range []struct {
				k string
				v any
			}{{"status", "aktif"}, {"is_active", true}, {"owner_id", t.UserID}, {"subscribed_until", until}} {
				if !upd(x.k, x.v, "Gagal menyimpan perubahan akun.") {
					return
				}
			}
			s.db.LogAdminAction(r.Context(), u.Email, "approve_pendaftaran", email, fmt.Sprintf("langganan %d bulan", dur))
		} else if action == "tolak_registrasi" {
			_ = upd("status", "diblokir", "Gagal menolak pendaftaran.")
			_ = upd("is_active", false, "Gagal menolak pendaftaran.")
			s.db.LogAdminAction(r.Context(), u.Email, "reject_pendaftaran", email, "pendaftaran ditolak")
		} else {
			base := time.Now()
			if t.SubscribedUntil != nil && t.SubscribedUntil.After(base) {
				base = *t.SubscribedUntil
			}
			if !upd("subscribed_until", base.AddDate(0, dur, 0), "Gagal memperpanjang langganan.") {
				return
			}
			s.db.LogAdminAction(r.Context(), u.Email, "perpanjang_langganan", email, fmt.Sprintf("+%d bulan", dur))
		}
	case "unlock_akun":
		if t.UserID == u.UserID {
			writeError(w, 403, CodeForbidden, "Anda tidak bisa membuka kunci akun sendiri. Hubungi atasan.")
			return
		}
		if e = s.db.UnlockAdmin(r.Context(), u.UserID, t.UserID); e != nil {
			fail("Gagal membuka kunci akun.")
			return
		}
		s.db.LogAdminAction(r.Context(), u.Email, "buka_kunci", email, "unlock akun terkunci")
	case "ubah_password", "edit_profil":
		details := []string{}
		pw := str(b, "new_password")
		if pw != "" {
			h, e := auth.HashPassword(pw)
			if e != nil || s.db.UpdateAdminPassword(r.Context(), t.UserID, h) != nil {
				writeError(w, 400, CodeValidationError, "Gagal mengubah password.")
				return
			}
			details = append(details, "password")
		}
		for _, f := range []struct{ k, db, msg, detail string }{{"nama_lengkap", "nama_lengkap", "Gagal mengubah nama.", "nama"}, {"username", "username", "Gagal mengubah username.", "username"}, {"nama_invoice", "nama_invoice", "Gagal mengubah nama invoice.", "nama_invoice"}} {
			v := str(b, f.k)
			if v != "" {
				if !upd(f.db, v, f.msg) {
					return
				}
				details = append(details, f.detail)
			}
		}
		detail := strings.Join(details, ",")
		if detail == "" {
			detail = "tidak ada perubahan"
		}
		s.db.LogAdminAction(r.Context(), u.Email, "edit_akun", email, detail)
	}
	writeSuccess(w, 200, map[string]any{"ok": true})
}
func knownAction(a string) bool {
	switch a {
	case "setujui_registrasi", "tolak_registrasi", "perpanjang_langganan", "unlock_akun", "ubah_password", "edit_profil", "set_role", "toggle_active":
		return true
	}
	return false
}
func (s *Server) handleAdminDataPost(w http.ResponseWriter, r *http.Request, u db.Identity) {
	if u.Role != "owner" && u.Role != "superadmin" {
		writeError(w, 403, CodeForbidden, "Anda tidak berhak menghapus data.")
		return
	}
	if u.Role == "superadmin" {
		writeError(w, 400, CodeValidationError, "Superadmin tidak memiliki data bisnis.")
		return
	}
	c, e := s.db.WipeTenant(r.Context(), u.UserID)
	if e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal menghapus data tenant.")
		return
	}
	writeSuccess(w, 200, map[string]any{"total": map[string]int{"inventaris": c.Inventory, "transaksi": c.Transactions, "log": c.Logs}})
}
