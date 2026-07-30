// A small CSV reader — port of core/src/data/csv.ts.
//
// The "load a file and plot a column" path, which is how most charts start.
// Quoted fields, doubled quotes as an escape, and LF or CRLF endings; nothing
// beyond that, because anything more is a job for a real CSV library and this
// one exists so that the simple case needs no dependency at all.
#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace photon::data {

struct CsvOptions {
  char delimiter = ',';
  /// Treat the first row as headers.
  bool header = true;
  /// Drop blank lines rather than emitting a one-empty-field row for each.
  bool skip_empty = true;
};

/// A parsed table: header names and string rows, with a numeric accessor.
class Table {
 public:
  Table() = default;
  Table(std::vector<std::string> headers, std::vector<std::vector<std::string>> rows)
      : headers_(std::move(headers)), rows_(std::move(rows)) {}

  const std::vector<std::string>& headers() const { return headers_; }
  size_t row_count() const { return rows_.size(); }
  size_t column_count() const { return headers_.size(); }

  /// The column's index, or -1 when there is no such header.
  int index_of(const std::string& name) const;

  /// One cell, or an empty string when the row or column is out of range.
  const std::string& cell(size_t row, size_t column) const;

  /// A whole column parsed to doubles; a cell that is not a number is NaN,
  /// which is what the layers already treat as a hole in a series.
  std::vector<double> numeric(size_t column) const;

 private:
  std::vector<std::string> headers_;
  std::vector<std::vector<std::string>> rows_;
};

Table parse_csv(const char* text, size_t length, const CsvOptions& opts = {});

}  // namespace photon::data
