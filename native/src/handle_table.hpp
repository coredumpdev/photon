// Generation-tagged handle table.
//
// The ABI hands out uint64 handles rather than pointers because two of the four
// target hosts free from a garbage collector's finalizer thread. With raw
// pointers a double-free or a use-after-free is undefined behaviour somewhere
// deep in the renderer; with a generation tag it is a PH_E_INVALID_HANDLE at the
// call that made the mistake.
//
// Encoding: high 32 bits = generation, low 32 bits = slot index + 1.
// A handle of 0 is therefore always invalid, matching PH_NULL_HANDLE.
#pragma once

#include <cstdint>
#include <memory>
#include <mutex>
#include <vector>

namespace photon {

template <typename T>
class HandleTable {
 public:
  uint64_t insert(std::unique_ptr<T> value) {
    std::lock_guard<std::mutex> lock(mutex_);
    uint32_t index;
    if (!free_.empty()) {
      index = free_.back();
      free_.pop_back();
    } else {
      index = static_cast<uint32_t>(slots_.size());
      slots_.push_back(Slot{1, nullptr});
    }
    slots_[index].value = std::move(value);
    return encode(index, slots_[index].generation);
  }

  /// Borrowed pointer, or nullptr when the handle is stale or never existed.
  /// Valid until the owning thread erases the entry — the ABI layer only ever
  /// uses it within a single call.
  T* get(uint64_t handle) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return lookup(handle);
  }

  bool erase(uint64_t handle) {
    std::unique_ptr<T> doomed;  // destroyed after the lock is released
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (!lookup(handle)) return false;
      const uint32_t index = static_cast<uint32_t>(handle & 0xffffffffu) - 1;
      doomed = std::move(slots_[index].value);
      // Bumping the generation is what invalidates every outstanding copy of
      // this handle. Wrapping past 0 would resurrect an old one, so skip 0.
      if (++slots_[index].generation == 0) slots_[index].generation = 1;
      free_.push_back(index);
    }
    return true;
  }

  /// Every live value, for teardown. Order is unspecified.
  std::vector<uint64_t> handles() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<uint64_t> out;
    for (uint32_t i = 0; i < slots_.size(); ++i) {
      if (slots_[i].value) out.push_back(encode(i, slots_[i].generation));
    }
    return out;
  }

  void clear() {
    std::vector<std::unique_ptr<T>> doomed;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      for (auto& slot : slots_) {
        if (slot.value) doomed.push_back(std::move(slot.value));
        if (++slot.generation == 0) slot.generation = 1;
      }
      slots_.clear();
      free_.clear();
    }
  }

 private:
  struct Slot {
    uint32_t generation;
    std::unique_ptr<T> value;
  };

  static uint64_t encode(uint32_t index, uint32_t generation) {
    return (static_cast<uint64_t>(generation) << 32) | (static_cast<uint64_t>(index) + 1);
  }

  // Caller holds mutex_.
  T* lookup(uint64_t handle) const {
    if (handle == 0) return nullptr;
    const uint64_t low = handle & 0xffffffffu;
    if (low == 0 || low > slots_.size()) return nullptr;
    const Slot& slot = slots_[static_cast<size_t>(low - 1)];
    if (slot.generation != static_cast<uint32_t>(handle >> 32)) return nullptr;
    return slot.value.get();
  }

  mutable std::mutex mutex_;
  std::vector<Slot> slots_;
  std::vector<uint32_t> free_;
};

}  // namespace photon
