#include "data/csv.hpp"

#include <algorithm>
#include <cstdlib>
#include <limits>

namespace photon::data {

namespace {

const std::string kEmpty;

std::vector<std::vector<std::string>> tokenize(const char* text, size_t length, char delim) {
  std::vector<std::vector<std::string>> rows;
  std::vector<std::string> row;
  std::string field;
  bool in_quotes = false;
  for (size_t i = 0; i < length; ++i) {
    const char c = text[i];
    if (in_quotes) {
      if (c == '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (i + 1 < length && text[i + 1] == '"') {
          field.push_back('"');
          ++i;
        } else {
          in_quotes = false;
        }
      } else {
        field.push_back(c);
      }
      continue;
    }
    if (c == '"') {
      in_quotes = true;
    } else if (c == delim) {
      row.push_back(field);
      field.clear();
    } else if (c == '\n' || c == '\r') {
      if (c == '\r' && i + 1 < length && text[i + 1] == '\n') ++i;
      row.push_back(field);
      rows.push_back(row);
      row.clear();
      field.clear();
    } else {
      field.push_back(c);
    }
  }
  if (!field.empty() || !row.empty()) {
    row.push_back(field);
    rows.push_back(row);
  }
  return rows;
}

std::string trim(const std::string& s) {
  size_t begin = 0;
  size_t end = s.size();
  const auto space = [](char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
  };
  while (begin < end && space(s[begin])) ++begin;
  while (end > begin && space(s[end - 1])) --end;
  return s.substr(begin, end - begin);
}

}  // namespace

int Table::index_of(const std::string& name) const {
  for (size_t i = 0; i < headers_.size(); ++i) {
    if (headers_[i] == name) return static_cast<int>(i);
  }
  return -1;
}

const std::string& Table::cell(size_t row, size_t column) const {
  if (row >= rows_.size() || column >= rows_[row].size()) return kEmpty;
  return rows_[row][column];
}

std::vector<double> Table::numeric(size_t column) const {
  std::vector<double> out(rows_.size(), std::numeric_limits<double>::quiet_NaN());
  for (size_t r = 0; r < rows_.size(); ++r) {
    const std::string& text = cell(r, column);
    if (text.empty()) continue;
    // strtod, like parseFloat, reads a leading number and ignores the tail; a
    // cell with no number at all leaves `end` at the start and stays NaN.
    char* end = nullptr;
    const double v = std::strtod(text.c_str(), &end);
    if (end != text.c_str()) out[r] = v;
  }
  return out;
}

Table parse_csv(const char* text, size_t length, const CsvOptions& opts) {
  if (!text) return Table();
  std::vector<std::vector<std::string>> all =
      tokenize(text, length, opts.delimiter == '\0' ? ',' : opts.delimiter);
  if (opts.skip_empty) {
    all.erase(std::remove_if(all.begin(), all.end(),
                             [](const std::vector<std::string>& r) {
                               return r.size() == 1 && trim(r[0]).empty();
                             }),
              all.end());
  }

  std::vector<std::string> headers;
  std::vector<std::vector<std::string>> rows;
  if (opts.header && !all.empty()) {
    headers.reserve(all[0].size());
    for (const std::string& h : all[0]) headers.push_back(trim(h));
    rows.assign(all.begin() + 1, all.end());
  } else {
    const size_t n = all.empty() ? 0 : all[0].size();
    headers.reserve(n);
    for (size_t i = 0; i < n; ++i) headers.push_back("col" + std::to_string(i));
    rows = std::move(all);
  }
  return Table(std::move(headers), std::move(rows));
}

}  // namespace photon::data
