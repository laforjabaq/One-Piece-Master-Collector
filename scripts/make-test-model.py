# Genera e2e/fixtures/tiny-embed.onnx: un "modelo" diminuto con la misma
# interfaz que DINOv2 (pixel_values [1,3,224,224] -> last_hidden_state [1,1,48])
# que promedia colores en una rejilla 4x4. Sirve para probar de punta a punta
# el worker + ONNX Runtime Web sin descargar el modelo real.
# Uso: pip install onnx && python3 scripts/make-test-model.py
import onnx
from onnx import TensorProto, helper

x = helper.make_tensor_value_info("pixel_values", TensorProto.FLOAT, [1, 3, 224, 224])
y = helper.make_tensor_value_info("last_hidden_state", TensorProto.FLOAT, [1, 1, 48])
shape = helper.make_tensor("shape", TensorProto.INT64, [3], [1, 1, 48])
g = helper.make_graph(
    [
        helper.make_node("AveragePool", ["pixel_values"], ["p"], kernel_shape=[56, 56], strides=[56, 56]),
        helper.make_node("Reshape", ["p", "shape"], ["last_hidden_state"]),
    ],
    "tiny-embed",
    [x],
    [y],
    [shape],
)
m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)], producer_name="opmc-test")
m.ir_version = 8
onnx.checker.check_model(m)
onnx.save(m, "e2e/fixtures/tiny-embed.onnx")
print("ok")
