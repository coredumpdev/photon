/*
 * A three-macro test harness.
 *
 * Deliberately not GoogleTest or Catch2: this repo's TypeScript half has zero
 * runtime dependencies, and the native half should be able to make the same
 * claim. It also means `cmake --build && ctest` works on a fresh machine with
 * no network, which is what the Windows and macOS CI legs need.
 *
 * Compiles as both C99 and C++, because the ABI has to be exercised from both.
 */
#ifndef PHOTON_TEST_CHECK_H
#define PHOTON_TEST_CHECK_H

#include <math.h>
#include <stdio.h>

static int ph_test_failures = 0;

#define CHECK(cond)                                                           \
  do {                                                                        \
    if (!(cond)) {                                                            \
      printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);                \
      ++ph_test_failures;                                                     \
    }                                                                         \
  } while (0)

#define CHECK_EQ(actual, expected)                                            \
  do {                                                                        \
    long long a_ = (long long)(actual);                                       \
    long long e_ = (long long)(expected);                                     \
    if (a_ != e_) {                                                           \
      printf("  FAIL %s:%d  %s == %s (got %lld, want %lld)\n",                \
             __FILE__, __LINE__, #actual, #expected, a_, e_);                 \
      ++ph_test_failures;                                                     \
    }                                                                         \
  } while (0)

/* Domains are computed through log/exp round trips, so exact equality is the
 * wrong bar; 1e-9 relative is far tighter than any rendering cares about. */
#define CHECK_NEAR(actual, expected, tol)                                     \
  do {                                                                        \
    double a_ = (double)(actual);                                             \
    double e_ = (double)(expected);                                           \
    if (!(fabs(a_ - e_) <= (tol))) {                                          \
      printf("  FAIL %s:%d  %s ~= %s (got %.17g, want %.17g)\n",              \
             __FILE__, __LINE__, #actual, #expected, a_, e_);                 \
      ++ph_test_failures;                                                     \
    }                                                                         \
  } while (0)

/* C++ only: compares std::string / const char* by value. */
#ifdef __cplusplus
#define CHECK_STR(actual, expected)                                           \
  do {                                                                        \
    std::string a_ = (actual);                                                \
    std::string e_ = (expected);                                              \
    if (a_ != e_) {                                                           \
      printf("  FAIL %s:%d  %s == %s (got \"%s\", want \"%s\")\n",            \
             __FILE__, __LINE__, #actual, #expected, a_.c_str(), e_.c_str()); \
      ++ph_test_failures;                                                     \
    }                                                                         \
  } while (0)
#endif

#define RUN(fn)                                                               \
  do {                                                                        \
    printf("%s\n", #fn);                                                      \
    fn();                                                                     \
  } while (0)

#define TEST_MAIN_RESULT()                                                    \
  (ph_test_failures == 0                                                      \
       ? (printf("all checks passed\n"), 0)                                   \
       : (printf("%d check(s) failed\n", ph_test_failures), 1))

#endif /* PHOTON_TEST_CHECK_H */
