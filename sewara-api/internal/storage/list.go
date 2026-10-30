package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Object adalah metadata objek hasil penelusuran bucket.
type Object struct {
	Key          string
	LastModified time.Time
	Size         int64
}

// List menelusuri semua objek dengan prefix, termasuk seluruh halaman R2.
func (s *Store) List(ctx context.Context, prefix string) ([]Object, error) {
	var objects []Object
	var token *string
	for {
		out, err := s.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket: aws.String(s.bucket), Prefix: aws.String(prefix), ContinuationToken: token,
		})
		if err != nil {
			return nil, fmt.Errorf("mendaftar objek prefix %q: %w", prefix, err)
		}
		for _, item := range out.Contents {
			if item.Key == nil {
				continue
			}
			obj := Object{Key: *item.Key}
			if item.LastModified != nil {
				obj.LastModified = *item.LastModified
			}
			if item.Size != nil {
				obj.Size = *item.Size
			}
			objects = append(objects, obj)
		}
		if out.IsTruncated == nil || !*out.IsTruncated || out.NextContinuationToken == nil {
			break
		}
		// R2 memotong hasil per halaman; token wajib diikuti agar objek lama tidak terlewat.
		token = out.NextContinuationToken
	}
	return objects, nil
}

// DeleteOlderThan menghapus objek ber-prefix yang lebih lama dari cutoff.
func (s *Store) DeleteOlderThan(ctx context.Context, prefix string, cutoff time.Time) (int, error) {
	objects, err := s.List(ctx, prefix)
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, object := range objects {
		if object.LastModified.IsZero() || !object.LastModified.Before(cutoff) {
			continue
		}
		if err := s.Delete(ctx, object.Key); err != nil {
			return deleted, err
		}
		deleted++
	}
	return deleted, nil
}
