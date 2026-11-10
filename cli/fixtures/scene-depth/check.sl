// Paints each pixel green where scene.depth reads the distance this pixel's ray travels to the
// wall (left half) or the camera's far distance (right half, the sky), red where it does not,
// and black down the wall's edge, where a pixel may be either. Pure colours, so a screenshot
// says the verdict whatever the colour space did to them.
texture2D depth;
texture2D scene;
uniform float wall = 10;
uniform float far = 1000;
uniform float tanY = 0.57735;
uniform float withScene = 0;

float4 main() {
    float d = tex2D(depth, uv).r;
    // Read so the program holds the scene texture too; it adds nothing to the colour.
    float s = tex2D(scene, uv).r * withScene * 0.0;
    // aspect is the program's own, and it covers the stage, as the camera does.
    float2 ndc = uv * 2 - 1;
    float2 aside = ndc * float2(tanY * aspect, tanY);
    float toWall = wall * sqrt(1 + dot(aside, aside));
    float edge = abs(uv.x - 0.5);
    float want = uv.x < 0.5 ? toWall : far;
    float slack = uv.x < 0.5 ? 0.05 + want * 0.002 : 1;
    float ok = abs(d - want) < slack ? 1 : 0;
    if (edge < 0.02) return float4(s, s, s, 1);
    return float4(1 - ok + s, ok, s, 1);
}
