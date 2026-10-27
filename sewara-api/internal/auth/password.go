package auth

import "golang.org/x/crypto/bcrypt"

// HashPassword menghasilkan hash bcrypt untuk password baru.
//
// Cost memakai DefaultCost (10), sama dengan yang dipakai Supabase, sehingga hash
// lama dan baru tidak bisa dibedakan dari bentuknya.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword mencocokkan password dengan hash tersimpan.
//
// bcrypt.CompareHashAndPassword membaca format $2a$, $2b$, dan $2y$ — tiga varian
// yang dipakai Supabase Auth. Artinya hash password pengguna lama bisa dipakai
// langsung tanpa memaksa mereka reset password.
func VerifyPassword(hash, password string) bool {
	if hash == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
