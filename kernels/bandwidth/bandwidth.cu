// Machine-specific memory probe for the RTX 4060 laptop.
// Measures device read/write/copy bandwidth and PCIe H2D/D2H for
// pageable and pinned host memory. Results are printed as JSON.
//
// Build: nvcc -O3 -arch=sm_89 -o bandwidth.exe bandwidth.cu
// Run:   bandwidth.exe [--size-mb 512] [--json out.json]

#include <cuda_runtime.h>
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#define CUDA_CHECK(x)                                                          \
    do {                                                                       \
        cudaError_t e_ = (x);                                                  \
        if (e_ != cudaSuccess) {                                               \
            std::fprintf(stderr, "CUDA error %s at %s:%d\n",                   \
                         cudaGetErrorString(e_), __FILE__, __LINE__);          \
            std::exit(2);                                                      \
        }                                                                      \
    } while (0)

struct Stats {
    double median = 0.0;
    double min = 0.0;
    double max = 0.0;
    std::vector<double> samples;
};

static double now_ms() {
    using clock = std::chrono::steady_clock;
    return std::chrono::duration<double, std::milli>(clock::now().time_since_epoch()).count();
}

static Stats summarize(std::vector<double> v) {
    Stats s;
    s.samples = v;
    if (v.empty()) return s;
    std::sort(v.begin(), v.end());
    s.min = v.front();
    s.max = v.back();
    s.median = v[v.size() / 2];
    return s;
}

// Read-only bandwidth: every thread reads float4 and accumulates. The final
// reduction is negligible and prevents the compiler from removing the loads.
__global__ void read_kernel(const float4 * __restrict__ src, float * __restrict__ sink, size_t n4) {
    size_t i = (size_t)blockIdx.x * blockDim.x + threadIdx.x;
    size_t stride = (size_t)gridDim.x * blockDim.x;
    float4 acc = make_float4(0.f, 0.f, 0.f, 0.f);
    for (; i < n4; i += stride) {
        float4 v = src[i];
        acc.x += v.x; acc.y += v.y; acc.z += v.z; acc.w += v.w;
    }
    if (acc.x == 1.2345e30f) sink[0] = acc.x + acc.y + acc.z + acc.w;
}

__global__ void write_kernel(float4 * __restrict__ dst, size_t n4) {
    size_t i = (size_t)blockIdx.x * blockDim.x + threadIdx.x;
    size_t stride = (size_t)gridDim.x * blockDim.x;
    float4 v = make_float4(1.f, 2.f, 3.f, 4.f);
    for (; i < n4; i += stride) dst[i] = v;
}

__global__ void copy_kernel(const float4 * __restrict__ src, float4 * __restrict__ dst, size_t n4) {
    size_t i = (size_t)blockIdx.x * blockDim.x + threadIdx.x;
    size_t stride = (size_t)gridDim.x * blockDim.x;
    for (; i < n4; i += stride) dst[i] = src[i];
}

enum ProbeMode { PROBE_READ, PROBE_WRITE, PROBE_COPY };

static void launch_probe(ProbeMode mode, const float4 * src, float4 * dst, size_t n4, float * sink) {
    if (mode == PROBE_READ) read_kernel<<<512, 256>>>(src, sink, n4);
    else if (mode == PROBE_WRITE) write_kernel<<<512, 256>>>(dst, n4);
    else copy_kernel<<<512, 256>>>(src, dst, n4);
}

static double bench_kernel(ProbeMode mode, const float4 * src, float4 * dst, size_t n4,
                           int iters, float * sink) {
    cudaEvent_t a, b;
    CUDA_CHECK(cudaEventCreate(&a));
    CUDA_CHECK(cudaEventCreate(&b));
    // warm-up
    for (int i = 0; i < 3; ++i) launch_probe(mode, src, dst, n4, sink);
    CUDA_CHECK(cudaDeviceSynchronize());
    std::vector<double> samples;
    for (int i = 0; i < iters; ++i) {
        CUDA_CHECK(cudaEventRecord(a));
        launch_probe(mode, src, dst, n4, sink);
        CUDA_CHECK(cudaEventRecord(b));
        CUDA_CHECK(cudaEventSynchronize(b));
        float ms = 0.f;
        CUDA_CHECK(cudaEventElapsedTime(&ms, a, b));
        samples.push_back(ms);
    }
    CUDA_CHECK(cudaEventDestroy(a));
    CUDA_CHECK(cudaEventDestroy(b));
    Stats s = summarize(samples);
    double bytes = (double)n4 * 16.0;
    if (mode == PROBE_COPY) bytes *= 2.0; // read + write
    return s.median > 0 ? bytes / (s.median * 1e6) : 0.0;
}

static double bench_memcpy(void * dst, const void * src, size_t bytes, cudaMemcpyKind kind, int iters) {
    cudaEvent_t a, b;
    CUDA_CHECK(cudaEventCreate(&a));
    CUDA_CHECK(cudaEventCreate(&b));
    for (int i = 0; i < 2; ++i) CUDA_CHECK(cudaMemcpy(dst, src, bytes, kind));
    CUDA_CHECK(cudaDeviceSynchronize());
    std::vector<double> samples;
    for (int i = 0; i < iters; ++i) {
        CUDA_CHECK(cudaEventRecord(a));
        CUDA_CHECK(cudaMemcpy(dst, src, bytes, kind));
        CUDA_CHECK(cudaEventRecord(b));
        CUDA_CHECK(cudaEventSynchronize(b));
        float ms = 0.f;
        CUDA_CHECK(cudaEventElapsedTime(&ms, a, b));
        samples.push_back(ms);
    }
    CUDA_CHECK(cudaEventDestroy(a));
    CUDA_CHECK(cudaEventDestroy(b));
    Stats s = summarize(samples);
    return s.median > 0 ? (double)bytes / (s.median * 1e6) : 0.0;
}

static void json_escape(const char * in, char * out, size_t n) {
    size_t j = 0;
    for (size_t i = 0; in[i] && j + 2 < n; ++i) {
        char c = in[i];
        if (c == '"' || c == '\\') { out[j++] = '\\'; out[j++] = c; }
        else if (c == '\n') { out[j++] = '\\'; out[j++] = 'n'; }
        else out[j++] = c;
    }
    out[j] = 0;
}

int main(int argc, char ** argv) {
    size_t size_mb = 512;
    std::string json_path;
    for (int i = 1; i < argc; ++i) {
        if (!std::strcmp(argv[i], "--size-mb") && i + 1 < argc) size_mb = (size_t)std::atoll(argv[++i]);
        else if (!std::strcmp(argv[i], "--json") && i + 1 < argc) json_path = argv[++i];
    }
    size_t bytes = size_mb * 1024ull * 1024ull;
    size_t n4 = bytes / sizeof(float4);

    cudaDeviceProp prop{};
    CUDA_CHECK(cudaGetDeviceProperties(&prop, 0));
    int driver_ver = 0, runtime_ver = 0;
    CUDA_CHECK(cudaDriverGetVersion(&driver_ver));
    CUDA_CHECK(cudaRuntimeGetVersion(&runtime_ver));

    void * dev_a = nullptr, * dev_b = nullptr, * host_page = nullptr, * host_pin = nullptr;
    float * sink = nullptr;
    CUDA_CHECK(cudaMalloc(&dev_a, bytes));
    CUDA_CHECK(cudaMalloc(&dev_b, bytes));
    CUDA_CHECK(cudaMalloc(&sink, 16));
    CUDA_CHECK(cudaHostAlloc(&host_page, bytes, cudaHostAllocDefault));
    CUDA_CHECK(cudaHostAlloc(&host_pin, bytes, cudaHostAllocPortable));
    std::memset(host_page, 0x5a, bytes);
    std::memset(host_pin, 0x5a, bytes);
    CUDA_CHECK(cudaMemset(dev_a, 0x11, bytes));

    // Pageable host memory: allocate with malloc, not cudaHostAlloc.
    void * host_pageable = std::malloc(bytes);
    std::memset(host_pageable, 0x33, bytes);

    double read_bw = bench_kernel(PROBE_READ, (const float4 *)dev_a, (float4 *)dev_b, n4, 10, sink);
    double write_bw = bench_kernel(PROBE_WRITE, (const float4 *)dev_a, (float4 *)dev_b, n4, 10, sink);
    double copy_bw = bench_kernel(PROBE_COPY, (const float4 *)dev_a, (float4 *)dev_b, n4, 10, sink);
    double d2d = bench_memcpy(dev_b, dev_a, bytes, cudaMemcpyDeviceToDevice, 10);
    double h2d_pageable = bench_memcpy(dev_a, host_pageable, bytes, cudaMemcpyHostToDevice, 5);
    double d2h_pageable = bench_memcpy(host_pageable, dev_a, bytes, cudaMemcpyDeviceToHost, 5);
    double h2d_pinned = bench_memcpy(dev_a, host_pin, bytes, cudaMemcpyHostToDevice, 5);
    double d2h_pinned = bench_memcpy(host_pin, dev_a, bytes, cudaMemcpyDeviceToHost, 5);

    std::printf("{\n");
    std::printf("  \"device\": \"%s\",\n", prop.name);
    std::printf("  \"compute_capability\": \"%d.%d\",\n", prop.major, prop.minor);
    std::printf("  \"sm_count\": %d,\n", prop.multiProcessorCount);
    std::printf("  \"global_mem_bytes\": %llu,\n", (unsigned long long)prop.totalGlobalMem);
    std::printf("  \"memory_bus_width\": %d,\n", prop.memoryBusWidth);
    std::printf("  \"memory_clock_khz\": %d,\n", prop.memoryClockRate);
    std::printf("  \"driver_version\": %d,\n", driver_ver);
    std::printf("  \"runtime_version\": %d,\n", runtime_ver);
    std::printf("  \"size_mb\": %llu,\n", (unsigned long long)size_mb);
    std::printf("  \"device_read_gbs\": %.3f,\n", read_bw);
    std::printf("  \"device_write_gbs\": %.3f,\n", write_bw);
    std::printf("  \"device_copy_gbs\": %.3f,\n", copy_bw);
    std::printf("  \"d2d_memcpy_gbs\": %.3f,\n", d2d);
    std::printf("  \"h2d_pageable_gbs\": %.3f,\n", h2d_pageable);
    std::printf("  \"d2h_pageable_gbs\": %.3f,\n", d2h_pageable);
    std::printf("  \"h2d_pinned_gbs\": %.3f,\n", h2d_pinned);
    std::printf("  \"d2h_pinned_gbs\": %.3f\n", d2h_pinned);
    std::printf("}\n");

    if (!json_path.empty()) {
        FILE * f = std::fopen(json_path.c_str(), "w");
        if (f) {
            std::fprintf(f, "{\n");
            std::fprintf(f, "  \"device\": \"%s\",\n", prop.name);
            std::fprintf(f, "  \"compute_capability\": \"%d.%d\",\n", prop.major, prop.minor);
            std::fprintf(f, "  \"sm_count\": %d,\n", prop.multiProcessorCount);
            std::fprintf(f, "  \"global_mem_bytes\": %llu,\n", (unsigned long long)prop.totalGlobalMem);
            std::fprintf(f, "  \"memory_bus_width\": %d,\n", prop.memoryBusWidth);
            std::fprintf(f, "  \"memory_clock_khz\": %d,\n", prop.memoryClockRate);
            std::fprintf(f, "  \"driver_version\": %d,\n", driver_ver);
            std::fprintf(f, "  \"runtime_version\": %d,\n", runtime_ver);
            std::fprintf(f, "  \"size_mb\": %llu,\n", (unsigned long long)size_mb);
            std::fprintf(f, "  \"device_read_gbs\": %.3f,\n", read_bw);
            std::fprintf(f, "  \"device_write_gbs\": %.3f,\n", write_bw);
            std::fprintf(f, "  \"device_copy_gbs\": %.3f,\n", copy_bw);
            std::fprintf(f, "  \"d2d_memcpy_gbs\": %.3f,\n", d2d);
            std::fprintf(f, "  \"h2d_pageable_gbs\": %.3f,\n", h2d_pageable);
            std::fprintf(f, "  \"d2h_pageable_gbs\": %.3f,\n", d2h_pageable);
            std::fprintf(f, "  \"h2d_pinned_gbs\": %.3f,\n", h2d_pinned);
            std::fprintf(f, "  \"d2h_pinned_gbs\": %.3f\n", d2h_pinned);
            std::fprintf(f, "}\n");
            std::fclose(f);
        }
    }

    CUDA_CHECK(cudaFree(dev_a));
    CUDA_CHECK(cudaFree(dev_b));
    CUDA_CHECK(cudaFree(sink));
    CUDA_CHECK(cudaFreeHost(host_page));
    CUDA_CHECK(cudaFreeHost(host_pin));
    std::free(host_pageable);
    return 0;
}
