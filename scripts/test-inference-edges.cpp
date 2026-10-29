// Exercise the existing ggml CPU/CUDA backends; this file implements no kernels.
#include "ggml.h"
#include "ggml-backend.h"
#include "ggml-alloc.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

static std::vector<float> compute(ggml_backend_t backend, int width, int batch,
    bool multiply, const std::vector<float>& a, const std::vector<float>& b) {
    std::unique_ptr<ggml_context, decltype(&ggml_free)> ctx(
        ggml_init({1024 * 1024, nullptr, true}), &ggml_free);
    if (!ctx) throw std::runtime_error("ggml_init failed");
    auto x = ggml_new_tensor_2d(ctx.get(), GGML_TYPE_F32, width, batch);
    auto y = ggml_new_tensor_2d(ctx.get(), GGML_TYPE_F32, width, batch);
    auto z = multiply ? ggml_mul(ctx.get(), x, y) : ggml_add(ctx.get(), x, y);
    auto graph = ggml_new_graph_custom(ctx.get(), 32, false);
    ggml_build_forward_expand(graph, z);
    std::unique_ptr<ggml_backend_buffer, decltype(&ggml_backend_buffer_free)> buffer(
        ggml_backend_alloc_ctx_tensors(ctx.get(), backend), &ggml_backend_buffer_free);
    if (!buffer) throw std::runtime_error("tensor allocation failed");
    ggml_backend_tensor_set(x, a.data(), 0, a.size() * sizeof(float));
    ggml_backend_tensor_set(y, b.data(), 0, b.size() * sizeof(float));
    if (ggml_backend_graph_compute(backend, graph) != GGML_STATUS_SUCCESS)
        throw std::runtime_error("graph compute failed");
    std::vector<float> result(a.size());
    ggml_backend_tensor_get(z, result.data(), 0, result.size() * sizeof(float));
    return result;
}
static bool equal(float actual, float expected) {
    if (std::isnan(expected)) return std::isnan(actual);
    if (std::isinf(expected)) return std::isinf(actual) && std::signbit(actual) == std::signbit(expected);
    return std::isfinite(actual) && std::fabs(actual - expected) <= 1e-5f * std::max(1.0f, std::fabs(expected));
}
int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("Expected backend DLL directory");
        ggml_backend_load_all_from_path(argv[1]);
        std::unique_ptr<ggml_backend, decltype(&ggml_backend_free)> cpu(ggml_backend_init_by_name("CPU", nullptr), &ggml_backend_free);
        std::unique_ptr<ggml_backend, decltype(&ggml_backend_free)> gpu(ggml_backend_init_by_name("CUDA0", nullptr), &ggml_backend_free);
        if (!cpu || !gpu) throw std::runtime_error("CPU/CUDA backend unavailable");
        const float inf = std::numeric_limits<float>::infinity();
        const float nan = std::numeric_limits<float>::quiet_NaN();
        const std::vector<float> av = {nan, inf, -inf, 0, -0.0f, 1, -1, 3.25f, -7.5f, 1e-12f, 1e12f};
        const std::vector<float> bv = {inf, -inf, nan, 0, 1, -3, 0.5f};
        int cases = 0, values = 0;
        for (int width : {17, 33, 65}) for (int batch : {1, 3, 7}) for (bool multiply : {false, true}) {
            std::vector<float> a(width * batch), b(a.size());
            for (size_t i = 0; i < a.size(); ++i) { a[i] = av[i % av.size()]; b[i] = bv[i % bv.size()]; }
            auto reference = compute(cpu.get(), width, batch, multiply, a, b);
            auto candidate = compute(gpu.get(), width, batch, multiply, a, b);
            for (size_t i = 0; i < a.size(); ++i) {
                const float expected = multiply ? a[i] * b[i] : a[i] + b[i];
                if (!equal(reference[i], expected) || !equal(candidate[i], expected) || !equal(candidate[i], reference[i]))
                    throw std::runtime_error("CPU/CUDA mismatch: width=" + std::to_string(width) + " batch=" + std::to_string(batch) + " index=" + std::to_string(i));
                ++values;
            }
            ++cases;
        }
        std::cout << "{\"passed\":" << cases << ",\"total\":18,\"values\":" << values
                  << ",\"operations\":[\"ADD_F32\",\"MUL_F32\"],\"widths\":[17,33,65],\"batches\":[1,3,7],\"nan\":true,\"inf\":true}\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
