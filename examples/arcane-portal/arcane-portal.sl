// Arcane portal: a ring of energy with a swirling core.
// A game drives both uniforms: the colour, and how fast it turns.
uniform float4 glow = #36c8ff;
uniform float speed = 1.0;

float4 main() {
    // Centred, square, and spun with time. Spinning keeps the radius.
    float2 q = rotate((uv - 0.5) * float2(aspect, 1) * 2, time * speed);
    float r = length(q);
    float swirl = fbm(q * 3 + r * 4, 4);
    // A thin ring whose radius wobbles with the noise, and a soft core.
    float edge = 0.015 / max(abs(r - 0.6 - (swirl - 0.5) * 0.2), 0.003);
    float light = edge + smoothstep(0.65, 0.0, r) * swirl;
    return float4(saturate(glow.rgb * light + edge * edge * 0.05), 1);
}
