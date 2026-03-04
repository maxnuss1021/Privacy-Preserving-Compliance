export const ComplianceDefinitionABI = [
  {
    type: "function",
    name: "getActiveVersion",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct ComplianceDefinition.ComplianceVersion",
        components: [
          { name: "verifier", type: "address", internalType: "address" },
          { name: "merkleRoot", type: "bytes32", internalType: "bytes32" },
          { name: "tStart", type: "uint256", internalType: "uint256" },
          { name: "tEnd", type: "uint256", internalType: "uint256" },
          { name: "metadataHash", type: "string", internalType: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getVersionAt",
    inputs: [
      { name: "blockHeight", type: "uint256", internalType: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct ComplianceDefinition.ComplianceVersion",
        components: [
          { name: "verifier", type: "address", internalType: "address" },
          { name: "merkleRoot", type: "bytes32", internalType: "bytes32" },
          { name: "tStart", type: "uint256", internalType: "uint256" },
          { name: "tEnd", type: "uint256", internalType: "uint256" },
          { name: "metadataHash", type: "string", internalType: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getVersionCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "verify",
    inputs: [
      { name: "proof", type: "bytes", internalType: "bytes" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "versions",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [
      { name: "verifier", type: "address", internalType: "address" },
      { name: "merkleRoot", type: "bytes32", internalType: "bytes32" },
      { name: "tStart", type: "uint256", internalType: "uint256" },
      { name: "tEnd", type: "uint256", internalType: "uint256" },
      { name: "metadataHash", type: "string", internalType: "string" },
    ],
    stateMutability: "view",
  },
  { type: "error", name: "NoActiveVersion", inputs: [] },
  {
    type: "error",
    name: "NoVersionAtBlock",
    inputs: [
      { name: "blockHeight", type: "uint256", internalType: "uint256" },
    ],
  },
  { type: "error", name: "NotRegulator", inputs: [] },
] as const;
