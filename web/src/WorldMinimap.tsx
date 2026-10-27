import { Home } from "lucide-react";
import { postNative, type WorldMap } from "./worldBridge";
import { soundEvent } from "./soundCues";
import "./world-minimap.css";

/** The atlas image comes from the real Unity scene. Everything interactive uses
 * its exact world extent, including the north-up camera footprint. */
export function WorldMinimap({
  map,
  blocked,
  theme,
}: {
  map: WorldMap;
  blocked: boolean;
  theme: string;
}) {
  const width = Math.max(1, map.extent.maxX - map.extent.minX);
  const depth = Math.max(1, map.extent.maxZ - map.extent.minZ);
  const x = (value: number) => ((value - map.extent.minX) / width) * 384;
  const y = (value: number) => ((map.extent.maxZ - value) / depth) * 240;
  const overview = () => {
    soundEvent("focused");
    postNative({ type: "camera", command: { type: "home" } });
  };
  const image = map.theme === theme ? map.image : undefined;
  const footprint = map.camera.footprint?.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.z),
  );
  return (
    <div
      className="world-minimap native-world-minimap"
      data-theme={theme}
      role="group"
      aria-label="World minimap"
    >
      <div className="atlas-heading">
        <span>{theme === "galaxy" ? "Star chart" : "Lake atlas"}</span>
        <span className="atlas-north" aria-label="North up">
          N ↑
        </span>
        <button
          aria-label="Minimap overview"
          data-tip={
            theme === "lake"
              ? "Frame the busiest island (F)"
              : "Fit the whole world (F)"
          }
          disabled={blocked}
          onClick={overview}
        >
          <Home size={13} />
        </button>
      </div>
      <div
        className="atlas-stage"
        role="group"
        aria-label="Hosts and camera position"
        aria-description="Click the map to move the camera. Focus a host or village marker to see its name; activate it to visit that place."
        aria-disabled={blocked}
        tabIndex={blocked ? -1 : 0}
        onClick={(event) => {
          if (blocked) return;
          const rect = event.currentTarget.getBoundingClientRect();
          postNative({
            type: "camera",
            command: {
              type: "map",
              x:
                map.extent.minX +
                ((event.clientX - rect.left) / rect.width) * width,
              z:
                map.extent.maxZ -
                ((event.clientY - rect.top) / rect.height) * depth,
            },
          });
        }}
        onKeyDown={(event) => {
          if (blocked || event.target !== event.currentTarget) return;
          if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            overview();
          } else if (event.key.startsWith("Arrow")) {
            event.preventDefault();
            event.stopPropagation();
            postNative({
              type: "camera",
              command: {
                type: "pan",
                x:
                  event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowLeft"
                      ? -1
                      : 0,
                z:
                  event.key === "ArrowUp"
                    ? 1
                    : event.key === "ArrowDown"
                      ? -1
                      : 0,
              },
            });
          }
        }}
      >
        {image && (
          <img
            className="atlas-world-image"
            src={image}
            alt=""
            draggable={false}
          />
        )}
        <svg
          className="atlas-projection"
          viewBox="0 0 384 240"
          aria-hidden="true"
        >
          {!image &&
            map.hosts.map((host) => (
              <rect
                key={host.key}
                className="atlas-fallback-region"
                x={x(host.x) - ((host.width || width * 0.1) / width) * 192}
                y={y(host.z) - ((host.depth || depth * 0.1) / depth) * 120}
                width={((host.width || width * 0.1) / width) * 384}
                height={((host.depth || depth * 0.1) / depth) * 240}
              />
            ))}
          {footprint && footprint.length === 4 && (
            <polygon
              className="atlas-camera-shadow"
              points={footprint
                .map((point) => `${x(point.x)},${y(point.z)}`)
                .join(" ")}
            />
          )}
          {footprint && footprint.length === 4 && (
            <polygon
              className="atlas-camera-footprint"
              points={footprint
                .map((point) => `${x(point.x)},${y(point.z)}`)
                .join(" ")}
            />
          )}
          <circle
            className="atlas-camera-center"
            cx={x(map.camera.x)}
            cy={y(map.camera.z)}
            r="2"
          />
        </svg>
        <div className="minimap-settlements atlas-hosts">
          {theme === "lake" &&
            map.theme === theme &&
            map.villages?.map((village) => (
              <button
                key={village.key}
                className="atlas-host atlas-village"
                disabled={blocked}
                style={
                  {
                    left: `${Math.max(4, Math.min(96, (x(village.x) / 384) * 100))}%`,
                    top: `${Math.max(7, Math.min(93, (y(village.z) / 240) * 100))}%`,
                    "--host-color": village.color,
                    "--label-align":
                      x(village.x) < 115
                        ? "0%"
                        : x(village.x) > 269
                          ? "-100%"
                          : "-50%",
                  } as React.CSSProperties
                }
                aria-label={`Focus ${village.name} village`}
                onClick={(event) => {
                  event.stopPropagation();
                  soundEvent("focused");
                  postNative({
                    type: "camera",
                    command: {
                      type: "focus",
                      target: { kind: "project", key: village.key },
                    },
                  });
                }}
              >
                <span className="atlas-host-mark" />
                <span className="atlas-host-label">{village.name}</span>
              </button>
            ))}
          {map.hosts.map((host) => (
            <button
              key={host.key}
              className="atlas-host"
              disabled={blocked}
              data-offline={host.state === "offline" || host.state === "stale"}
              style={
                {
                  left: `${Math.max(4, Math.min(96, (x(host.x) / 384) * 100))}%`,
                  top: `${Math.max(7, Math.min(93, (y(host.z) / 240) * 100))}%`,
                  "--host-color": host.color || "#d5be89",
                  "--label-align":
                    x(host.x) < 115 ? "0%" : x(host.x) > 269 ? "-100%" : "-50%",
                } as React.CSSProperties
              }
              aria-label={`Focus ${host.name}`}
              aria-description={
                host.state === "offline" || host.state === "stale"
                  ? "Host is offline"
                  : "Focus this host region"
              }
              onClick={(event) => {
                event.stopPropagation();
                soundEvent("focused");
                postNative({
                  type: "camera",
                  command: {
                    type: "focus",
                    target: { kind: "host", key: host.key },
                  },
                });
              }}
            >
              <span className="atlas-host-mark" />
              <span className="atlas-host-label">
                {host.name}
                {host.state === "offline" || host.state === "stale"
                  ? " · Offline"
                  : ""}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="atlas-location">
        {map.context ||
          `${map.hosts.length} ${map.hosts.length === 1 ? "host" : "hosts"}`}
      </div>
    </div>
  );
}
