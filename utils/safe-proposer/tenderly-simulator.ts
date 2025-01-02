import { Address } from 'viem';

interface TenderlyConfig {
  accessKey: string;
  user: string;
  project: string;
}

interface SimulationRequest {
  chainId: number;
  from: Address;
  to: Address;
  input: string;
  value: string;
}

export async function simulateOnTenderly(
  config: TenderlyConfig,
  request: SimulationRequest
): Promise<string> {
  const baseUrl = 'https://api.tenderly.co/api/v1';
  const headers = {
    'X-Access-Key': config.accessKey,
    'Content-Type': 'application/json',
  };

  // 1. Simulate the transaction
  const simulateUrl = `${baseUrl}/account/${config.user}/project/${config.project}/simulate`;

  const simulateBody = {
    network_id: request.chainId.toString(),
    from: request.from,
    to: request.to,
    input: request.input,
    value: request.value,
    save: true,
    simulation_type: 'full',
    save_if_fails: true
  };

  try {
    const simulateResponse = await fetch(simulateUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(simulateBody),
    });

    if (!simulateResponse.ok) {
      const errorText = await simulateResponse.text();
      throw new Error(`Simulation failed! status: ${simulateResponse.status}, details: ${errorText}`);
    }

    const simulateData = await simulateResponse.json();
    const simulationId = simulateData.simulation.id;

    // 2. Share the simulation
    const shareUrl = `${baseUrl}/account/${config.user}/project/${config.project}/simulations/${simulationId}/share`;
    
    const shareResponse = await fetch(shareUrl, {
      method: 'POST',
      headers,
    });

    if (!shareResponse.ok) {
      const errorText = await shareResponse.text();
      throw new Error(`Share failed! status: ${shareResponse.status}, details: ${errorText}`);
    }

    // 3. Return the public simulation URL
    return `https://www.tdly.co/shared/simulation/${simulationId}`;
  } catch (error) {
    console.error('Tenderly simulation/share failed:', error);
    throw error;
  }
}