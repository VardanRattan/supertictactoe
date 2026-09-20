import os
import warnings
import logging
warnings.filterwarnings('ignore')
logging.getLogger('torch.onnx').setLevel(logging.ERROR)

import torch
import torch.nn as nn
import torch.nn.functional as F

class ResBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        out = F.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out = F.relu(out + residual)
        return out

class SuperTicTacToeNet(nn.Module):
    """
    Dual-Headed Convolutional ResNet for Super Tic-Tac-Toe.
    Input: (B, 6, 9, 9) spatial tensor.
    Outputs:
      - policy_logits: (B, 81) unnormalized action scores.
      - value: (B, 1) scalar in [-1, 1] representing win/draw/loss expectation.
    """

    def __init__(self, in_channels: int = 6, num_res_blocks: int = 6, num_channels: int = 64):
        super().__init__()
        self.conv_in = nn.Conv2d(in_channels, num_channels, kernel_size=3, padding=1, bias=False)
        self.bn_in = nn.BatchNorm2d(num_channels)

        self.res_blocks = nn.ModuleList([ResBlock(num_channels) for _ in range(num_res_blocks)])

        # Policy Head
        self.policy_conv = nn.Conv2d(num_channels, 32, kernel_size=1, bias=False)
        self.policy_bn = nn.BatchNorm2d(32)
        self.policy_fc = nn.Linear(32 * 9 * 9, 81)

        # Value Head
        self.value_conv = nn.Conv2d(num_channels, 8, kernel_size=1, bias=False)
        self.value_bn = nn.BatchNorm2d(8)
        self.value_fc1 = nn.Linear(8 * 9 * 9, 64)
        self.value_fc2 = nn.Linear(64, 1)

    def forward(self, x: torch.Tensor):
        out = F.relu(self.bn_in(self.conv_in(x)))
        for block in self.res_blocks:
            out = block(out)

        # Policy
        p = F.relu(self.policy_bn(self.policy_conv(out)))
        p = p.flatten(1)
        policy_logits = self.policy_fc(p)

        # Value
        v = F.relu(self.value_bn(self.value_conv(out)))
        v = v.flatten(1)
        v = F.relu(self.value_fc1(v))
        value = torch.tanh(self.value_fc2(v))

        return policy_logits, value

    def predict(self, x: torch.Tensor, legal_mask: torch.Tensor = None):
        """
        Runs evaluation in eval mode with no_grad and applies legal move masking.
        Returns: (policy_probs, value)
        """
        self.eval()
        with torch.no_grad():
            policy_logits, value = self(x)
            if legal_mask is not None:
                # Mask illegal moves with -1e9 before softmax
                policy_logits[~legal_mask] = -1e9
            policy_probs = F.softmax(policy_logits, dim=-1)
            return policy_probs, value

def export_to_onnx(model: SuperTicTacToeNet, filepath: str):
    """Exports model to ONNX as a single self-contained file for direct browser execution."""
    import onnx
    cpu_model = SuperTicTacToeNet()
    cpu_model.load_state_dict({k: v.cpu() for k, v in model.state_dict().items()})
    cpu_model.eval()
    dummy_input = torch.randn(1, 6, 9, 9, dtype=torch.float32)
    torch.onnx.export(
        cpu_model,
        dummy_input,
        filepath,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['policy_logits', 'value']
    )
    # Ensure all tensor weights are embedded into a single file
    m = onnx.load(filepath, load_external_data=True)
    onnx.save(m, filepath)
    data_file = f"{filepath}.data"
    if os.path.exists(data_file):
        os.remove(data_file)
    print(f"Model exported successfully to {filepath}!")
