import jwt from "jsonwebtoken";

const { JWT_SECRET, JWT_ISS="weave", JWT_AUD="weave-client" } = process.env;

export function signJwt(payload, opts={}) {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS256",
    issuer: JWT_ISS,
    audience: JWT_AUD,
    expiresIn: opts.expiresIn ?? "12h",
  });
}

export function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: JWT_ISS,
    audience: JWT_AUD,
  });
}
